/**
 * Scrape bill sponsor and voting information from the House of Representatives (Shugiin) website
 *
 * This script:
 * 1. Fetches bill listings from shugiin.go.jp for each Diet session
 * 2. Extracts sponsor/supporter information for 衆法 and 参法 bills
 * 3. Extracts voting group information for all bill types
 * 4. Updates existing bills in the database (requires scrape_sangiin.ts to be run first)
 *
 * Usage:
 *   pnpm tsx scripts/scrape_shugiin.ts [startSession] [endSession] [--dry-run]
 */

import dotenv from 'dotenv';
dotenv.config();

import { fetch } from 'undici';
import { load } from 'cheerio';
import { eq, and, inArray } from 'drizzle-orm';
import {
	createDbConnection,
	batchGetOrCreateMembers,
	batchGetOrCreateGroups,
	parseArgs,
	hasFlag,
	getPositionalInt,
	resolveUrl,
	sleep,
	parseJapaneseDate,
	getLatestSessionNumber,
	DrizzleDB,
	type BillType,
	schema
} from './lib';

// Configuration
const BASE_URL = 'https://www.shugiin.go.jp';
const DEFAULT_START_SESSION = 198;
const FALLBACK_END_SESSION = 219; // Used only if database is unavailable
const RATE_LIMIT_MS = 500;
const BILL_CONCURRENCY = 5; // Max parallel bill detail fetches

// Pre-compiled regex for performance
const WHITESPACE_RE = /[\s\u3000]+/g;

// Types
interface BillEntry {
	session: number;
	number: number;
	title: string;
	detailUrl: string;
}

interface BillDetails {
	billType: BillType | null;
	sponsors: string[];
	sponsorGroups: string[];
	supporters: string[];
	approvalGroups: string[];
	rejectionGroups: string[];
	shugiinVotingDate: string | null;
}

interface BillData extends BillEntry, BillDetails {}

// Rate limiter for Shugiin requests
let lastRequestTime = 0;

async function waitForRateLimit(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastRequestTime;
	if (elapsed < RATE_LIMIT_MS) {
		await sleep(RATE_LIMIT_MS - elapsed);
	}
	lastRequestTime = Date.now();
}

/**
 * Fetch Shift-JIS encoded page with retry logic
 */
async function fetchShiftJIS(
	url: string,
	maxRetries = 3,
	baseDelayMs = 1000
): Promise<string | null> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			await waitForRateLimit();

			const res = await fetch(url);
			if (res.status !== 200) {
				console.warn(`Failed to fetch ${url}: ${res.status}`);
				return null;
			}

			const buffer = await res.arrayBuffer();
			const decoder = new TextDecoder('shift-jis');
			return decoder.decode(buffer);
		} catch (err) {
			lastError = err as Error;
			const delay = baseDelayMs * Math.pow(2, attempt);
			console.warn(
				`Attempt ${attempt + 1}/${maxRetries} failed for ${url}, retrying in ${delay}ms...`
			);
			await sleep(delay);
		}
	}

	console.error(`All ${maxRetries} attempts failed for ${url}:`, lastError?.message);
	return null;
}

/**
 * Run promises with concurrency limit
 */
async function runWithConcurrency<T, R>(
	items: T[],
	fn: (item: T, index: number) => Promise<R>,
	limit: number
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let currentIndex = 0;

	async function worker(): Promise<void> {
		while (currentIndex < items.length) {
			const index = currentIndex++;
			results[index] = await fn(items[index], index);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
	await Promise.all(workers);

	return results;
}

/**
 * Normalize a member name by removing honorifics and whitespace
 */
function normalizeMemberName(name: string): string {
	return name.replace(/君$/, '').replace(WHITESPACE_RE, '').trim();
}

/**
 * Parse member names from a semicolon-separated string
 */
function parseMemberNames(text: string): string[] {
	if (!text?.trim()) return [];
	return text
		.split(';')
		.map((name) => normalizeMemberName(name.trim()))
		.filter((name) => name.length > 0);
}

/**
 * Parse sponsor name from 議案提出者 field (fallback for when 議案提出者一覧 is empty)
 */
function parseSponsorFromSingle(text: string): string | null {
	if (!text?.trim()) return null;

	// Committee chair submissions (e.g., "厚生労働委員長")
	if (text.includes('委員長')) {
		return text.trim();
	}

	// Pattern: "Name外N名" (Name plus N others)
	const match = text.match(/^(.+?)外[〇一二三四五六七八九十百千]+名/);
	if (match) {
		return normalizeMemberName(match[1]);
	}

	return normalizeMemberName(text);
}

/**
 * Parse group names from a semicolon-separated string
 */
function parseGroupNames(text: string): string[] {
	if (!text?.trim()) return [];
	return text
		.split(';')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
}

/**
 * Search for committee chair using Kokkai API
 */
async function searchCommitteeChair(
	committeeName: string,
	submissionSession: number,
	chamber: '衆議院' | '参議院'
): Promise<string | null> {
	try {
		console.log(
			`    Searching for committee chair: ${committeeName} (Session ${submissionSession}, ${chamber})`
		);

		const params = new URLSearchParams({
			nameOfMeeting: committeeName,
			nameOfHouse: chamber,
			sessionFrom: submissionSession.toString(),
			sessionTo: submissionSession.toString(),
			recordPacking: 'json',
			maximumRecords: '1'
		});

		const apiUrl = `https://kokkai.ndl.go.jp/api/meeting?${params.toString()}`;
		console.log(`    Kokkai API URL: ${apiUrl}`);

		await waitForRateLimit();

		const res = await fetch(apiUrl);
		if (res.status !== 200) {
			console.warn(`    Failed to fetch from Kokkai API: ${res.status}`);
			return null;
		}

		const data = (await res.json()) as {
			numberOfRecords: number;
			numberOfReturn: number;
			meetingRecord?: Array<{
				nameOfMeeting: string;
				issue: string;
				date: string;
				speechRecord: Array<{
					speechOrder: number;
					speaker: string;
					speech?: string;
				}>;
			}>;
		};

		console.log(`    Found ${data.numberOfRecords} meeting(s)`);

		if (!data.meetingRecord || data.numberOfReturn === 0) {
			console.warn(`    No meetings found for ${committeeName}`);
			return null;
		}

		const meeting = data.meetingRecord[0];
		console.log(`    Meeting: ${meeting.nameOfMeeting} ${meeting.issue} (${meeting.date})`);

		const meetingInfo = meeting.speechRecord.find(
			(s) => s.speechOrder === 0 && s.speaker === '会議録情報'
		);

		if (!meetingInfo || !meetingInfo.speech) {
			console.warn(`    Could not find meeting info record`);
			return null;
		}

		const pattern = /委員長[\s\u3000]+([^\r\n]+君)/;
		const match = meetingInfo.speech.match(pattern);

		if (match) {
			const chairName = match[1]
				.replace(/君$/, '')
				.replace(/\s+/g, '')
				.replace(/\u3000/g, '')
				.trim();

			console.log(`    ✓ Found committee chair: ${chairName}`);
			return chairName;
		}

		console.warn(`    Could not extract chair name from meeting info`);
		return null;
	} catch (err) {
		console.error(`    Error searching for committee chair:`, err);
		return null;
	}
}

/**
 * Extract bill details from a detail page (pure scraping, no DB operations)
 */
async function fetchBillDetails(billDetailUrl: string): Promise<BillDetails | null> {
	try {
		const detailBody = await fetchShiftJIS(billDetailUrl);
		if (!detailBody) return null;

		const $detail = load(detailBody);

		let billType: string | null = null;
		let sponsors: string[] = [];
		let sponsorFromSingle: string | null = null;
		let sponsorGroups: string[] = [];
		let supporters: string[] = [];
		let approvalGroups: string[] = [];
		let rejectionGroups: string[] = [];
		let shugiinVotingDate: string | null = null;

		$detail('table tr').each((_, row) => {
			const cells = $detail(row).find('td');
			if (cells.length < 2) return;

			const th = cells.eq(0).find('span').text().trim();
			const td = cells.eq(1).find('span').text().trim();

			if (th === '議案種類' && td) billType = td;
			if (th === '議案提出者一覧' && td) sponsors = parseMemberNames(td);
			if (th === '議案提出者' && td) sponsorFromSingle = parseSponsorFromSingle(td);
			if (th === '議案提出会派' && td) sponsorGroups = parseGroupNames(td);
			if (th === '議案提出の賛成者' && td) supporters = parseMemberNames(td);
			if (th === '衆議院審議時賛成会派' && td) approvalGroups = parseGroupNames(td);
			if (th === '衆議院審議時反対会派' && td) rejectionGroups = parseGroupNames(td);

			if (th === '衆議院審議終了年月日／衆議院審議結果' && td) {
				const dateMatch = td.match(/^([^／]+)／/);
				if (dateMatch) {
					shugiinVotingDate = parseJapaneseDate(dateMatch[1]);
				}
			}
		});

		// Fallback for sponsors when 議案提出者一覧 is empty
		if (sponsors.length === 0 && sponsorFromSingle) {
			sponsors = [sponsorFromSingle];
		}

		// Map billType to BillType or null if not valid
		const validBillType: BillType | null =
			billType === '衆法' || billType === '参法' || billType === '閣法' ? billType : null;

		return {
			billType: validBillType,
			sponsors,
			sponsorGroups,
			supporters,
			approvalGroups,
			rejectionGroups,
			shugiinVotingDate
		};
	} catch (err) {
		console.error(`Error fetching bill details from ${billDetailUrl}:`, err);
		return null;
	}
}

/**
 * Save bill sponsor and voting data to database
 */
async function saveBillToDatabase(db: DrizzleDB, billData: BillData): Promise<void> {
	const {
		session,
		number,
		billType,
		sponsors,
		sponsorGroups,
		supporters,
		approvalGroups,
		rejectionGroups,
		shugiinVotingDate
	} = billData;

	if (!billType) {
		console.log(`  Skipping unsupported bill type`);
		return;
	}

	// Check if bill exists
	const existingBills = await db
		.select()
		.from(schema.bill)
		.where(
			and(
				eq(schema.bill.type, billType),
				eq(schema.bill.submissionSession, session),
				eq(schema.bill.number, number)
			)
		);

	if (existingBills.length === 0) {
		console.error(`  ERROR: Bill not found in database: ${billType}-${session}-${number}`);
		console.error(`  Please run scrape_sangiin.ts first to populate the bill database.`);
		return;
	}

	const billId = existingBills[0].id as number;
	console.log(`  Found bill in database with ID: ${billId}`);

	// All groups from Shugiin website are 衆議院 groups
	const chamber: '衆議院' | '参議院' = '衆議院';

	// Process 衆法 bills - add sponsors, sponsor groups, and supporters
	if (billType === '衆法') {
		console.log(`  Processing 衆法 bill...`);
		await processSponsorsAndSupporters(db, billId, sponsors, sponsorGroups, supporters, chamber);
	}
	// Process 参法 bills - add sponsors only (no supporters from Shugiin)
	else if (billType === '参法') {
		console.log(`  Processing 参法 bill...`);

		// Handle committee chair sponsor lookup - replace title with actual name
		const committeeChairTitle = sponsors.find((name) => name.includes('委員長'));
		let actualSponsors = sponsors;

		if (committeeChairTitle) {
			console.log(`  Bill sponsor is a committee chair: ${committeeChairTitle}`);
			const committeeName = committeeChairTitle.replace('委員長', '委員会');
			const chairName = await searchCommitteeChair(committeeName, session, '参議院');

			if (chairName) {
				// Replace the committee chair title with the actual person's name
				actualSponsors = sponsors.map((name) => (name === committeeChairTitle ? chairName : name));
				console.log(`  Resolved committee chair to: ${chairName}`);
			} else {
				// Could not find chair name, skip adding the title as a sponsor
				actualSponsors = sponsors.filter((name) => name !== committeeChairTitle);
				console.log(`  Could not resolve committee chair, skipping: ${committeeChairTitle}`);
			}
		}

		// Note: 参法 bills don't have sponsor groups from Shugiin, passing empty array
		await processSponsorsAndSupporters(db, billId, actualSponsors, [], [], chamber);
	}

	// Process voting groups for ALL bill types
	if (approvalGroups.length > 0 || rejectionGroups.length > 0) {
		await processVotingGroups(db, billId, shugiinVotingDate, approvalGroups, rejectionGroups);
	}

	console.log(`  Successfully processed bill: ${billType}-${session}-${number}`);
}

/**
 * Process sponsors and supporters for a bill (BATCHED)
 */
async function processSponsorsAndSupporters(
	db: DrizzleDB,
	billId: number,
	sponsors: string[],
	sponsorGroups: string[],
	supporters: string[],
	chamber: '衆議院' | '参議院'
) {
	// Collect all unique member names and group names
	const allMemberNames = [...new Set([...sponsors, ...supporters])];
	const allGroupNames = [...new Set(sponsorGroups)];

	// BATCH: Get or create all members and groups at once
	const memberMap = await batchGetOrCreateMembers(db, allMemberNames);
	const groupMap = await batchGetOrCreateGroups(db, allGroupNames, chamber);

	// BATCH: Check existing sponsors
	const sponsorMemberIds = sponsors.map((name) => memberMap.get(name)!).filter(Boolean);
	const existingSponsors =
		sponsorMemberIds.length > 0
			? await db
					.select()
					.from(schema.billSponsors)
					.where(
						and(
							eq(schema.billSponsors.billId, billId),
							inArray(schema.billSponsors.memberId, sponsorMemberIds)
						)
					)
			: [];
	const existingSponsorIds = new Set(existingSponsors.map((s) => s.memberId));

	// BATCH: Insert new sponsors
	const newSponsors = sponsors
		.map((name) => memberMap.get(name)!)
		.filter((id) => id && !existingSponsorIds.has(id))
		.map((memberId) => ({ billId, memberId }));

	if (newSponsors.length > 0) {
		await db.insert(schema.billSponsors).values(newSponsors);
		console.log(`  Added ${newSponsors.length} sponsors`);
	}

	// BATCH: Check existing sponsor groups
	const sponsorGroupIds = sponsorGroups.map((name) => groupMap.get(name)!).filter(Boolean);
	const existingSponsorGroups =
		sponsorGroupIds.length > 0
			? await db
					.select()
					.from(schema.billSponsorGroups)
					.where(
						and(
							eq(schema.billSponsorGroups.billId, billId),
							inArray(schema.billSponsorGroups.groupId, sponsorGroupIds)
						)
					)
			: [];
	const existingSponsorGroupIds = new Set(existingSponsorGroups.map((g) => g.groupId));

	// BATCH: Insert new sponsor groups
	const newSponsorGroups = sponsorGroups
		.map((name) => groupMap.get(name)!)
		.filter((id) => id && !existingSponsorGroupIds.has(id))
		.map((groupId) => ({ billId, groupId }));

	if (newSponsorGroups.length > 0) {
		await db.insert(schema.billSponsorGroups).values(newSponsorGroups);
		console.log(`  Added ${newSponsorGroups.length} sponsor groups`);
	}

	// BATCH: Check existing supporters
	const supporterMemberIds = supporters.map((name) => memberMap.get(name)!).filter(Boolean);
	const existingSupporters =
		supporterMemberIds.length > 0
			? await db
					.select()
					.from(schema.billSupporters)
					.where(
						and(
							eq(schema.billSupporters.billId, billId),
							inArray(schema.billSupporters.memberId, supporterMemberIds)
						)
					)
			: [];
	const existingSupporterIds = new Set(existingSupporters.map((s) => s.memberId));

	// BATCH: Insert new supporters
	const newSupporters = supporters
		.map((name) => memberMap.get(name)!)
		.filter((id) => id && !existingSupporterIds.has(id))
		.map((memberId) => ({ billId, memberId }));

	if (newSupporters.length > 0) {
		await db.insert(schema.billSupporters).values(newSupporters);
		console.log(`  Added ${newSupporters.length} supporters`);
	}
}

/**
 * Process voting groups for a bill
 */
async function processVotingGroups(
	db: DrizzleDB,
	billId: number,
	votingDate: string | null,
	approvalGroups: string[],
	rejectionGroups: string[]
) {
	console.log(`\n  Processing voting groups...`);
	console.log(`  Voting date: ${votingDate}`);
	console.log(`  Approval groups: ${approvalGroups.join(', ')}`);
	console.log(`  Rejection groups: ${rejectionGroups.join(', ')}`);

	if (!votingDate) {
		console.warn(`  WARNING: No voting date found, cannot link to bill_votes`);
		return;
	}

	// Find matching bill_votes entry
	const existingVotes = await db
		.select()
		.from(schema.billVotes)
		.where(
			and(
				eq(schema.billVotes.billId, billId),
				eq(schema.billVotes.chamber, '衆議院'),
				eq(schema.billVotes.votingDate, votingDate)
			)
		);

	console.log(`  Found ${existingVotes.length} matching bill_votes entries`);

	if (existingVotes.length === 0) {
		const anyVotes = await db
			.select()
			.from(schema.billVotes)
			.where(and(eq(schema.billVotes.billId, billId), eq(schema.billVotes.chamber, '衆議院')));

		console.error(
			`  ERROR: No bill_votes entry found for bill ${billId} with voting date ${votingDate}`
		);
		if (anyVotes.length > 0) {
			console.error(`  However, found ${anyVotes.length} vote(s) for this bill in 衆議院:`);
			anyVotes.forEach((vote) => {
				console.error(
					`    - Vote ID ${vote.id}: date=${vote.votingDate}, method=${vote.votingMethod}`
				);
			});
		}
		return;
	}

	const voteId = existingVotes[0].id as number;
	console.log(`  Found bill_votes entry with ID: ${voteId}`);

	// BATCH: Get or create all groups at once (voting in 衆議院, so groups are 衆議院)
	const allGroupNames = [...new Set([...approvalGroups, ...rejectionGroups])];
	const groupMap = await batchGetOrCreateGroups(db, allGroupNames, '衆議院');

	// BATCH: Check existing vote results for all groups
	const allGroupIds = [...groupMap.values()];
	const existingResults =
		allGroupIds.length > 0
			? await db
					.select()
					.from(schema.billVotesResultGroup)
					.where(
						and(
							eq(schema.billVotesResultGroup.billVotesId, voteId),
							inArray(schema.billVotesResultGroup.groupId, allGroupIds)
						)
					)
			: [];
	const existingGroupIds = new Set(existingResults.map((r) => r.groupId));

	// BATCH: Insert approval group results
	const newApprovalResults = approvalGroups
		.map((name) => groupMap.get(name)!)
		.filter((id) => id && !existingGroupIds.has(id))
		.map((groupId) => ({ billVotesId: voteId, groupId, approved: true }));

	// BATCH: Insert rejection group results
	const newRejectionResults = rejectionGroups
		.map((name) => groupMap.get(name)!)
		.filter((id) => id && !existingGroupIds.has(id))
		.map((groupId) => ({ billVotesId: voteId, groupId, approved: false }));

	const allNewResults = [...newApprovalResults, ...newRejectionResults];
	if (allNewResults.length > 0) {
		await db.insert(schema.billVotesResultGroup).values(allNewResults);
		console.log(
			`  Added ${newApprovalResults.length} approval groups, ${newRejectionResults.length} rejection groups`
		);
	}
}

/**
 * Extract bill entries from a session page
 */
function extractBillEntries($: ReturnType<typeof load>, sessionUrl: string): BillEntry[] {
	const entries: BillEntry[] = [];

	$('table tr').each((_, row) => {
		const cells = $(row).find('td');
		if (cells.length < 3) return;

		const billSession = parseInt(cells.eq(0).text().trim());
		const billNumber = parseInt(cells.eq(1).text().trim());
		const billTitle = cells.eq(2).text().trim();

		if (isNaN(billSession) || isNaN(billNumber) || !billTitle) return;

		const detailLink = cells.eq(4).find('a').attr('href');
		if (!detailLink) return;

		entries.push({
			session: billSession,
			number: billNumber,
			title: billTitle,
			detailUrl: resolveUrl(sessionUrl, detailLink)
		});
	});

	return entries;
}

async function main() {
	const args = parseArgs();
	const DRY_RUN = hasFlag(args, 'dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	const startSession = getPositionalInt(args, 0, DEFAULT_START_SESSION)!;
	const endSessionArg = getPositionalInt(args, 1);

	if (!DATABASE_URL && !DRY_RUN) {
		console.error('DATABASE_URL is not set. Provide DATABASE_URL or run with --dry-run.');
		process.exit(1);
	}

	let client: { end: () => Promise<void> } | null = null;
	let db: DrizzleDB | null = null;

	if (!DRY_RUN && DATABASE_URL) {
		const conn = createDbConnection(DATABASE_URL);
		client = conn.client;
		db = conn.db;
	}

	// Determine end session: use argument if provided, otherwise query database, fallback to constant
	let endSession: number;
	if (endSessionArg !== undefined) {
		endSession = endSessionArg;
	} else if (db) {
		const latestSession = await getLatestSessionNumber(db);
		if (latestSession !== null) {
			endSession = latestSession;
			console.log(`Using latest session from database: ${endSession}`);
		} else {
			endSession = FALLBACK_END_SESSION;
			console.log(`No sessions found in database, using fallback: ${endSession}`);
		}
	} else {
		endSession = FALLBACK_END_SESSION;
		console.log(`Database not available, using fallback end session: ${endSession}`);
	}

	console.log(`Processing sessions ${startSession} to ${endSession}`);

	try {
		for (let session = startSession; session <= endSession; session++) {
			console.log(`\n=== Processing Session ${session} ===`);
			const sessionUrl = `${BASE_URL}/internet/itdb_gian.nsf/html/gian/kaiji${session}.htm`;

			const body = await fetchShiftJIS(sessionUrl);
			if (!body) continue;

			const $ = load(body);

			// Extract all bill entries from session page
			const billEntries = extractBillEntries($, sessionUrl);
			console.log(`Found ${billEntries.length} bills to process`);

			if (billEntries.length === 0) continue;

			// Fetch bill details in parallel with concurrency limit
			console.log(`Fetching bill details (concurrency=${BILL_CONCURRENCY})...`);
			const billDetails = await runWithConcurrency(
				billEntries,
				async (entry, i) => {
					console.log(
						`[${i + 1}/${billEntries.length}] Fetching: Session ${entry.session}, Number ${entry.number}`
					);
					const details = await fetchBillDetails(entry.detailUrl);
					if (!details) return null;
					return { ...entry, ...details };
				},
				BILL_CONCURRENCY
			);

			// Process each bill (database operations)
			for (const billData of billDetails) {
				if (!billData) continue;

				console.log(
					`\nProcessing: ${billData.billType || 'unknown'}-${billData.session}-${billData.number}: ${billData.title}`
				);
				console.log(`  Bill type: ${billData.billType}`);
				console.log(`  Sponsors: ${billData.sponsors.length} members`);
				console.log(`  Sponsor groups: ${billData.sponsorGroups.length} groups`);
				console.log(`  Supporters: ${billData.supporters.length} members`);
				console.log(`  Approval groups: ${billData.approvalGroups.length} groups`);
				console.log(`  Rejection groups: ${billData.rejectionGroups.length} groups`);

				if (DRY_RUN || !db) {
					console.log(
						`[DRY-RUN] Would process bill: ${billData.billType}-${billData.session}-${billData.number}`
					);
					continue;
				}

				try {
					await saveBillToDatabase(db, billData);
				} catch (err) {
					console.error(
						`Error saving bill ${billData.billType}-${billData.session}-${billData.number}:`,
						err
					);
				}
			}
		}

		console.log('\nDone');
	} finally {
		if (client) await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
