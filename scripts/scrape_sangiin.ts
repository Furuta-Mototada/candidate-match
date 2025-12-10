/**
 * Scrape bill information from the House of Councillors (Sangiin) website
 *
 * This script:
 * 1. Fetches bill listings from sangiin.go.jp for each Diet session
 * 2. Extracts bill metadata, deliberation status, and voting records
 * 3. Stores data in the database
 *
 * Usage:
 *   pnpm tsx scripts/scrape_sangiin.ts [startSession] [endSession] [--dry-run]
 */

import { load } from 'cheerio';
import { eq, and, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import {
	fetchWithRetry,
	resolveUrl,
	parseArgs,
	hasFlag,
	getPositionalInt,
	createDbConnection,
	schema,
	parseJapaneseDate,
	batchGetOrCreateMembers,
	getOrCreateCommittee,
	type DrizzleDB,
	type BillType,
	type VotingMethod
} from './lib';

// Configuration
const BASE_URL = 'https://www.sangiin.go.jp';
const DEFAULT_START_SESSION = 198;
const DEFAULT_END_SESSION = 219;
const BILL_CONCURRENCY = 5; // Max parallel bill detail fetches

// Pre-compiled regex for performance
const WHITESPACE_RE = /\s+/g;

// Types
interface Committee {
	name: string;
	chamber: '衆議院' | '参議院';
}

interface Vote {
	chamber: '衆議院' | '参議院';
	method: string;
	date: string | null;
	voteUrl?: string;
}

interface VoteMember {
	name: string;
	approved: boolean;
}

interface BillData {
	billType: BillType;
	billSession: number;
	billNumber: number;
	billTitle: string;
	billDetailUrl: string;
	submissionDate: string | null;
	billResult: '可決' | '否決' | '撤回' | '未了' | null;
	resultDate: string | null;
	committeeName: string | null; // 委員会発議の場合の委員会名
	committees: Committee[];
	votes: Vote[];
	shuginVoteDate: string | null;
	sanginVoteDate: string | null;
}

/**
 * Map voting method variations to standard enum values
 */
const VOTING_METHOD_MAP: Record<string, VotingMethod> = {
	異議なし採決: '異議なし採決',
	異議の有無: '異議なし採決',
	起立投票: '起立投票',
	起立: '起立投票',
	記名投票: '記名投票',
	押しボタン: '押しボタン'
};

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

// Cached cabinets data (loaded once per run)
let cachedCabinets: Array<{
	memberId: number;
	startDate: string;
	endDate: string | null;
}> | null = null;

/**
 * Get cached cabinets or load them
 */
async function getCabinets(
	db: DrizzleDB
): Promise<Array<{ memberId: number; startDate: string; endDate: string | null }>> {
	if (cachedCabinets) return cachedCabinets;

	const cabinets = await db.select().from(schema.cabinet);
	cachedCabinets = cabinets.map((c) => ({
		memberId: c.memberId,
		startDate: String(c.startDate),
		endDate: c.endDate ? String(c.endDate) : null
	}));
	return cachedCabinets;
}

/**
 * Find prime minister for a given date
 */
function findPrimeMinisterForDate(
	cabinets: Array<{ memberId: number; startDate: string; endDate: string | null }>,
	date: string
): number | null {
	for (const cabinet of cabinets) {
		if (cabinet.startDate <= date && (!cabinet.endDate || cabinet.endDate >= date)) {
			return cabinet.memberId;
		}
	}
	return null;
}

// Committee cache
const committeeCache = new Map<string, number>();

/**
 * Get or create committee with caching
 */
async function getCachedCommittee(
	db: DrizzleDB,
	name: string,
	chamber: '衆議院' | '参議院'
): Promise<number> {
	const key = `${chamber}:${name}`;
	if (committeeCache.has(key)) {
		return committeeCache.get(key)!;
	}
	const id = await getOrCreateCommittee(db, name, chamber);
	committeeCache.set(key, id);
	return id;
}

/**
 * Extract bill details from a detail page (pure scraping, no DB)
 */
async function fetchBillDetails(
	billDetailUrl: string,
	billSession: number
): Promise<{
	submissionDate: string | null;
	billResult: '可決' | '否決' | '撤回' | '未了' | null;
	resultDate: string | null;
	committeeName: string | null;
	committees: Committee[];
	votes: Vote[];
	shuginVoteDate: string | null;
	sanginVoteDate: string | null;
}> {
	let submissionDate: string | null = null;
	let billResult: '可決' | '否決' | '撤回' | '未了' | null = null;
	let resultDate: string | null = null;
	let committeeName: string | null = null;
	const committees: Committee[] = [];
	const votes: Vote[] = [];
	let shuginVoteDate: string | null = null;
	let sanginVoteDate: string | null = null;

	if (!billDetailUrl) {
		return {
			submissionDate,
			billResult,
			resultDate,
			committeeName,
			committees,
			votes,
			shuginVoteDate,
			sanginVoteDate
		};
	}

	try {
		const detailRes = await fetchWithRetry(billDetailUrl);
		if (detailRes.status !== 200) {
			return {
				submissionDate,
				billResult,
				resultDate,
				committeeName,
				committees,
				votes,
				shuginVoteDate,
				sanginVoteDate
			};
		}

		const detailBody = await detailRes.text();
		const $detail = load(detailBody);

		// Variables to track deliberation status
		let remarks = '';
		let firstOriginatedChamber = '';
		let shuginPlenary = '';
		let sanginPlenary = '';
		let shuginResult = ''; // 衆議院本会議の議決結果
		let sanginResult = ''; // 参議院本会議の議決結果
		let submitterType = ''; // 提出者区分
		let submitter = ''; // 提出者

		// Extract metadata from table rows
		$detail('table tr').each((_, row) => {
			const $row = $detail(row);
			const th = $row.find('th').text().trim();
			const td = $row.find('td').text().trim();

			if (th === '提出日' && td && td !== '　' && td !== '') {
				const parsedDate = parseJapaneseDate(td);
				if (parsedDate) submissionDate = parsedDate;
			}

			if (th === '公布年月日' && td && td !== '　' && td !== '') {
				const pubDate = parseJapaneseDate(td);
				if (pubDate) {
					billResult = '可決';
					// Note: resultDate will be set later based on vote dates
				}
			}

			if (th === '先議区分' && td && td !== '　' && td !== '') {
				firstOriginatedChamber = td;
			}

			if (th === '提出者区分' && td && td !== '　' && td !== '') {
				submitterType = td;
			}

			if (th === '提出者' && td && td !== '　' && td !== '') {
				submitter = td;
			}
		});

		// For 委員会発議 bills, extract committee name from 提出者 (e.g., "厚生労働委員長" → "厚生労働委員会")
		if (submitterType === '委員会発議' && submitter.endsWith('委員長')) {
			committeeName = submitter.replace(/委員長$/, '委員会');
		}

		// Extract 備考 from the special table structure (summary="備考情報")
		// This table has <th colspan="2">備考</th> in one row and <td colspan="2">content</td> in another
		const bikoTable = $detail('table[summary="備考情報"]');
		if (bikoTable.length > 0) {
			const bikoTd = bikoTable.find('td').text().trim();
			if (bikoTd && bikoTd !== '　' && bikoTd !== '') {
				remarks = bikoTd;
				// Check for 撤回 and extract date
				if (remarks.includes('撤回')) {
					billResult = '撤回';
					// Try to extract date from remarks (e.g., "令和元年5月24日 撤回申出")
					const dateMatch = remarks.match(
						/(?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/
					);
					if (dateMatch) {
						const withdrawalDate = parseJapaneseDate(dateMatch[0]);
						if (withdrawalDate) {
							resultDate = withdrawalDate;
						}
					}
				}
			}
		}

		// Extract committees from both chambers
		const processChamberCommittees = (chamberName: '衆議院' | '参議院') => {
			$detail('table').each((_, table) => {
				const tableHeader = $detail(table).find('th[colspan="2"]').text().trim();
				if (tableHeader.includes(`${chamberName}委員会等経過`)) {
					$detail(table)
						.find('tr')
						.each((__, row) => {
							const th = $detail(row).find('th').text().trim();
							const td = $detail(row).find('td').text().trim();
							if (th === '付託委員会等' && td && td !== '　' && td !== '') {
								committees.push({ name: td, chamber: chamberName });
							}
						});
				}
			});
		};

		processChamberCommittees('衆議院');
		processChamberCommittees('参議院');

		// Extract voting information
		const processChamberVotes = (chamberName: '衆議院' | '参議院'): string | null => {
			let chamberVoteDate: string | null = null;

			$detail('table').each((_, table) => {
				const tableHeader = $detail(table).find('th[colspan="2"]').text().trim();
				if (tableHeader.includes(`${chamberName}本会議経過`)) {
					let voteMethod: string | null = null;
					let voteDate: string | null = null;
					let voteUrl: string | null = null;
					let result: string | null = null;

					$detail(table)
						.find('tr')
						.each((__, row) => {
							const th = $detail(row).find('th').text().trim();
							const td = $detail(row).find('td');
							const tdText = td.text().trim();

							if (th === '採決方法' && tdText && tdText !== '　') {
								voteMethod = tdText.split('（')[0].trim();
								const link = td.find('a');
								if (link.length > 0) {
									const href = link.attr('href');
									if (href) voteUrl = resolveUrl(billDetailUrl, href);
								}
							}

							if (th === '議決日' && tdText && tdText !== '　') {
								voteDate = parseJapaneseDate(tdText);
							}

							if (th === '議決' && tdText && tdText !== '　') {
								result = tdText;
							}
						});

					// Track plenary activity and determine bill result
					if (chamberName === '衆議院') {
						shuginPlenary = voteMethod || result || '';
						shuginResult = result || '';
						chamberVoteDate = voteDate;
						if (result === '否決') {
							billResult = '否決';
							resultDate = voteDate;
						}
					} else if (chamberName === '参議院') {
						sanginPlenary = voteMethod || result || '';
						sanginResult = result || '';
						chamberVoteDate = voteDate;
						if (result === '否決' && firstOriginatedChamber === '本院先議') {
							billResult = '否決';
							resultDate = voteDate;
						}
					}

					if (voteMethod && voteMethod !== '－') {
						votes.push({
							chamber: chamberName,
							method: voteMethod,
							date: voteDate,
							voteUrl: voteUrl || undefined
						});
					}
				}
			});

			return chamberVoteDate;
		};

		shuginVoteDate = processChamberVotes('衆議院');
		sanginVoteDate = processChamberVotes('参議院');

		// If both chambers have voted 可決, the bill has passed
		// This catches cases where 公布年月日 might not be present yet
		if (!billResult && shuginResult === '可決' && sanginResult === '可決') {
			billResult = '可決';
		}

		// For 成立 (可決) bills, set resultDate to the later of the two plenary vote dates
		// Note: billResult can be '可決', '否決', '撤回', '未了', or null at this point
		if ((billResult as string) === '可決' && !resultDate) {
			if (shuginVoteDate && sanginVoteDate) {
				resultDate = shuginVoteDate > sanginVoteDate ? shuginVoteDate : sanginVoteDate;
			} else {
				resultDate = shuginVoteDate || sanginVoteDate;
			}
		}

		// Check for 未了 case (only for completed sessions)
		// Note: resultDate for 未了 will be set in saveBillToDatabase using session end date
		if (billSession < DEFAULT_END_SESSION && !shuginPlenary && !sanginPlenary && !billResult) {
			billResult = '未了';
		}
	} catch (err) {
		console.error(`Error fetching bill detail for ${billDetailUrl}:`, err);
	}

	return {
		submissionDate,
		billResult,
		resultDate,
		committeeName,
		committees,
		votes,
		shuginVoteDate,
		sanginVoteDate
	};
}

// Session end date cache
const sessionEndDateCache = new Map<number, string | null>();

/**
 * Get session end date from database with caching
 */
async function getSessionEndDate(db: DrizzleDB, sessionNumber: number): Promise<string | null> {
	if (sessionEndDateCache.has(sessionNumber)) {
		return sessionEndDateCache.get(sessionNumber) ?? null;
	}

	const sessions = await db
		.select()
		.from(schema.congressSession)
		.where(eq(schema.congressSession.sessionNumber, sessionNumber));

	const endDate = sessions.length > 0 && sessions[0].endDate ? String(sessions[0].endDate) : null;
	sessionEndDateCache.set(sessionNumber, endDate);
	return endDate;
}

/**
 * Save bill data to the database
 */
async function saveBillToDatabase(
	db: DrizzleDB,
	billData: BillData,
	startSession: number,
	cabinets: Array<{ memberId: number; startDate: string; endDate: string | null }>
): Promise<void> {
	const {
		billType,
		billSession,
		billNumber,
		billTitle,
		submissionDate,
		billResult,
		committeeName,
		committees,
		votes
	} = billData;

	let resultDate = billData.resultDate;

	// For 未了 bills, set resultDate to the session end date
	if (billResult === '未了' && !resultDate) {
		const sessionEndDate = await getSessionEndDate(db, billSession);
		if (sessionEndDate) {
			resultDate = sessionEndDate;
			console.log(`Set 未了 resultDate to session end date: ${resultDate}`);
		}
	}

	// Check if bill exists
	const existingBills = await db
		.select()
		.from(schema.bill)
		.where(
			and(
				eq(schema.bill.type, billType),
				eq(schema.bill.submissionSession, billSession),
				eq(schema.bill.number, billNumber)
			)
		);

	let billId: number;

	if (existingBills.length === 0) {
		const [insertedBill] = await db
			.insert(schema.bill)
			.values({
				type: billType,
				submissionSession: billSession,
				number: billNumber,
				title: billTitle,
				submissionDate: submissionDate,
				result: billResult,
				resultDate: resultDate,
				committeeName: committeeName
			})
			.returning();

		billId = insertedBill.id;
		console.log(`Inserted bill ID: ${billId}`);

		// Insert submission session into bill_session table
		await db.insert(schema.billSession).values({
			billId: billId,
			sessionNumber: billSession,
			isSubmissionSession: true
		});
		console.log(`Inserted bill_session: bill=${billId}, session=${billSession} (submission)`);
	} else {
		billId = existingBills[0].id;
		console.log(`Bill already exists with ID: ${billId}`);

		// Ensure this session is recorded in bill_session (for carry-over bills)
		const existingBillSession = await db
			.select()
			.from(schema.billSession)
			.where(
				and(
					eq(schema.billSession.billId, billId),
					eq(schema.billSession.sessionNumber, startSession)
				)
			);

		if (existingBillSession.length === 0) {
			// This bill appeared in a session we're scraping - record it
			await db.insert(schema.billSession).values({
				billId: billId,
				sessionNumber: startSession,
				isSubmissionSession: startSession === billSession
			});
			console.log(
				`Inserted bill_session: bill=${billId}, session=${startSession} (${startSession === billSession ? 'submission' : 'carry-over'})`
			);
		}
	}

	// Update bill result status and committeeName
	await db
		.update(schema.bill)
		.set({ result: billResult, resultDate, committeeName })
		.where(eq(schema.bill.id, billId));

	console.log(
		`Updated bill result: result=${billResult}, resultDate=${resultDate}, committeeName=${committeeName}`
	);

	// Process committees using cache
	// Use startSession (the session being scraped) for committee_bill, not billSession (submission session)
	for (const committee of committees) {
		const committeeId = await getCachedCommittee(db, committee.name, committee.chamber);

		const existingCommitteeBills = await db
			.select()
			.from(schema.committeeBill)
			.where(
				and(
					eq(schema.committeeBill.committeeId, committeeId),
					eq(schema.committeeBill.billId, billId),
					eq(schema.committeeBill.session, startSession)
				)
			);

		if (existingCommitteeBills.length === 0) {
			await db.insert(schema.committeeBill).values({
				committeeId,
				billId,
				session: startSession
			});
			console.log(
				`Inserted committee_bill: committee=${committeeId}, bill=${billId}, session=${startSession}`
			);
		}
	}

	// Process Cabinet bill sponsors using cached cabinets
	if (billType === '閣法' && submissionDate !== null) {
		const existingSponsors = await db
			.select()
			.from(schema.billSponsors)
			.where(eq(schema.billSponsors.billId, billId));

		if (existingSponsors.length === 0) {
			const primeMinisterId = findPrimeMinisterForDate(cabinets, submissionDate);

			if (primeMinisterId) {
				await db.insert(schema.billSponsors).values({ billId, memberId: primeMinisterId });
				console.log(`Inserted bill_sponsor: bill=${billId}, member=${primeMinisterId}`);
			}
		}
	}

	// Process votes
	for (const vote of votes) {
		const votingMethod = VOTING_METHOD_MAP[vote.method];
		if (!votingMethod) {
			console.warn(`Unknown voting method: ${vote.method}`);
			continue;
		}

		// Build the where clause conditionally for null dates
		const whereConditions = [
			eq(schema.billVotes.billId, billId),
			eq(schema.billVotes.chamber, vote.chamber)
		];

		// Check for existing vote
		const existingVotes = await db
			.select()
			.from(schema.billVotes)
			.where(and(...whereConditions))
			.then((results) =>
				results.filter((r) => {
					if (vote.date === null) return r.votingDate === null;
					return r.votingDate === vote.date;
				})
			);

		let voteId: number;
		if (existingVotes.length > 0) {
			voteId = existingVotes[0].id;
			console.log(`Vote already exists with ID: ${voteId}`);
		} else {
			const [insertedVote] = await db
				.insert(schema.billVotes)
				.values({
					billId,
					session: startSession,
					chamber: vote.chamber,
					votingMethod: votingMethod,
					votingDate: vote.date
				})
				.returning();

			voteId = insertedVote.id;
			console.log(
				`Inserted bill_vote: ${voteId} (${vote.chamber}, ${vote.method}, session=${startSession})`
			);
		}

		// Process individual vote results for 押しボタン
		if (vote.method === '押しボタン' && vote.voteUrl) {
			await processVoteResults(db, voteId, vote.voteUrl);
		}
	}
}

/**
 * Process individual vote results from a vote page (BATCHED)
 */
async function processVoteResults(db: DrizzleDB, voteId: number, voteUrl: string): Promise<void> {
	console.log(`Fetching vote results from: ${voteUrl}`);

	try {
		const voteRes = await fetchWithRetry(voteUrl);
		if (voteRes.status !== 200) return;

		const voteBody = await voteRes.text();
		const $vote = load(voteBody);

		// Collect all vote data first
		const voteData: VoteMember[] = [];

		const hasNewStructure = $vote('li.giin').length > 0;
		const hasOldStructure = $vote('td.nam').length > 0;

		if (hasNewStructure) {
			console.log('Using NEW structure (li.giin with span elements)');
			$vote('li.giin').each((_, element) => {
				const $element = $vote(element);
				const memberName = $element.find('span.names').text().trim().replace(WHITESPACE_RE, '');
				if (!memberName) return;

				const prosText = $element.find('span.pros').text().trim();
				const consText = $element.find('span.cons').text().trim();
				if (!prosText && !consText) return;

				voteData.push({ name: memberName, approved: prosText === '賛成' });
			});
		} else if (hasOldStructure) {
			console.log('Using OLD structure (table with td.pro, td.con, td.nam)');
			$vote('tr').each((_, element) => {
				const $element = $vote(element);
				const nameCells = $element.find('td.nam');

				nameCells.each((__, nameCell) => {
					const $nameCell = $vote(nameCell);
					const memberName = $nameCell.text().trim().replace(WHITESPACE_RE, '');
					if (!memberName) return;

					let proCell = null;
					let conCell = null;
					let currentCell = $nameCell.prev();
					while (currentCell.length > 0) {
						if (currentCell.hasClass('con')) conCell = currentCell;
						else if (currentCell.hasClass('pro')) {
							proCell = currentCell;
							break;
						}
						currentCell = currentCell.prev();
					}

					if (!proCell || !conCell) return;

					const hasProImage = proCell.find('img').length > 0;
					const hasConImage = conCell.find('img').length > 0;

					if (hasProImage && !hasConImage) {
						voteData.push({ name: memberName, approved: true });
					} else if (hasConImage && !hasProImage) {
						voteData.push({ name: memberName, approved: false });
					}
				});
			});
		}

		if (voteData.length === 0) {
			console.warn(`No vote data found for ${voteUrl}`);
			return;
		}

		console.log(`Found ${voteData.length} votes to process`);

		// BATCH: Get or create all members at once
		const memberNames = voteData.map((v) => v.name);
		const memberMap = await batchGetOrCreateMembers(db, memberNames);

		// BATCH: Check existing vote results
		const memberIds = [...memberMap.values()];
		const existingResults = await db
			.select()
			.from(schema.billVotesResultMember)
			.where(
				and(
					eq(schema.billVotesResultMember.billVotesId, voteId),
					inArray(schema.billVotesResultMember.memberId, memberIds)
				)
			);

		const existingMemberIds = new Set(existingResults.map((r) => r.memberId));

		// BATCH: Insert new vote results
		const newResults = voteData
			.filter((v) => {
				const memberId = memberMap.get(v.name);
				return memberId && !existingMemberIds.has(memberId);
			})
			.map((v) => ({
				billVotesId: voteId,
				memberId: memberMap.get(v.name)!,
				approved: v.approved
			}));

		if (newResults.length > 0) {
			await db.insert(schema.billVotesResultMember).values(newResults);
			console.log(`Inserted ${newResults.length} vote results`);
		} else {
			console.log('All vote results already exist');
		}
	} catch (err) {
		console.error(`Error fetching vote results from ${voteUrl}:`, err);
	}
}

interface BillEntry {
	billType: BillType;
	billSession: number;
	billNumber: number;
	billTitle: string;
	billDetailUrl: string;
}

/**
 * Extract bill entries from a session page
 */
function extractBillEntries(
	$: ReturnType<typeof load>,
	sessionUrl: string,
	startSession: number
): BillEntry[] {
	const billTypes: Array<{ name: BillType; selector: string }> = [
		{ name: '閣法', selector: 'h2:contains("法律案（内閣提出）")' },
		{ name: '衆法', selector: 'h2:contains("法律案（衆法）")' },
		{ name: '参法', selector: 'h2:contains("法律案（参法）")' }
	];

	const entries: BillEntry[] = [];

	for (const billType of billTypes) {
		const table = $(billType.selector).next('table');
		if (table.length === 0) continue;

		const rows = table.find('tr');
		for (let i = 0; i < rows.length; i++) {
			const row = rows.eq(i);
			const cells = row.find('td');
			if (cells.length < 3) continue;

			const billSession = parseInt(cells.eq(0).text().trim());
			const billNumber = parseInt(cells.eq(1).text().trim());
			const billTitle = cells.eq(2).text().trim();

			if (billSession < startSession) continue;

			const link = cells.eq(2).find('a').attr('href');
			const billDetailUrl = link ? resolveUrl(sessionUrl, link) : '';

			entries.push({
				billType: billType.name,
				billSession,
				billNumber,
				billTitle,
				billDetailUrl
			});
		}
	}

	return entries;
}

async function main() {
	const args = parseArgs();
	const DRY_RUN = hasFlag(args, 'dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	const startSession = getPositionalInt(args, 0, DEFAULT_START_SESSION)!;
	const endSession = getPositionalInt(args, 1, DEFAULT_END_SESSION)!;

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

	console.log(`Processing sessions ${startSession} to ${endSession}`);

	// Pre-load cabinets for efficiency (only if DB is available)
	let cabinets: Array<{ memberId: number; startDate: string; endDate: string | null }> = [];
	if (db) {
		cabinets = await getCabinets(db);
		console.log(`Loaded ${cabinets.length} cabinet records`);
	}

	try {
		for (let session = startSession; session <= endSession; session++) {
			console.log(`\n=== Processing Session ${session} ===`);
			const sessionUrl = `${BASE_URL}/japanese/joho1/kousei/gian/${session}/gian.htm`;

			try {
				const res = await fetchWithRetry(sessionUrl);
				if (res.status !== 200) {
					console.warn(`Failed to fetch session ${session} page: ${res.status}`);
					continue;
				}

				const body = await res.text();
				const $ = load(body);

				// Extract all bill entries from session page
				const billEntries = extractBillEntries($, sessionUrl, startSession);
				console.log(`Found ${billEntries.length} bills to process`);

				if (billEntries.length === 0) continue;

				// Fetch bill details in parallel with concurrency limit
				console.log(`Fetching bill details (concurrency=${BILL_CONCURRENCY})...`);
				const billDetails = await runWithConcurrency(
					billEntries,
					async (entry, i) => {
						console.log(
							`[${i + 1}/${billEntries.length}] Fetching: ${entry.billType}-${entry.billSession}-${entry.billNumber}`
						);
						const details = await fetchBillDetails(entry.billDetailUrl, entry.billSession);
						return { ...entry, ...details };
					},
					BILL_CONCURRENCY
				);

				// Process each bill (database operations)
				for (const billData of billDetails) {
					console.log(
						`\nProcessing: ${billData.billType}-${billData.billSession}-${billData.billNumber}: ${billData.billTitle}`
					);

					if (DRY_RUN || !db) {
						console.log(`[DRY-RUN] Would insert/update bill`);
						console.log(`  Title: ${billData.billTitle}`);
						console.log(`  Submission Date: ${billData.submissionDate}`);
						console.log(`  Result: ${billData.billResult}`);
						console.log(`  Result Date: ${billData.resultDate}`);
						console.log(`  Committee Name: ${billData.committeeName}`);
						console.log(`  Committees: ${JSON.stringify(billData.committees)}`);
						console.log(`  Votes: ${billData.votes.length}`);
						continue;
					}

					try {
						await saveBillToDatabase(db, billData, session, cabinets);
					} catch (err) {
						console.error(
							`Error saving bill ${billData.billType}-${billData.billSession}-${billData.billNumber}:`,
							err
						);
					}
				}
			} catch (err) {
				console.error(`Error processing session ${session}:`, err);
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
