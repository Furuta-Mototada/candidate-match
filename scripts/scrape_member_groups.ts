import dotenv from 'dotenv';
dotenv.config();

import * as schema from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	createDbConnection,
	getOrCreateGroup,
	parseArgs,
	hasFlag,
	getPositionalArg,
	DrizzleDB,
	fetchWithRetry
} from './lib';

const KOKKAI_API_BASE = 'https://kokkai.ndl.go.jp/api/speech';
const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds as recommended by API docs

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SpeechRecord {
	speakerGroup: string;
	date: string;
}

interface GroupAffiliation {
	groupName: string;
	firstDate: string;
	lastDate: string;
	speechCount: number;
}

/**
 * Kokkai API response type
 */
interface KokkaiSpeechResponse {
	numberOfRecords: number;
	numberOfReturn: number;
	nextRecordPosition?: number;
	speechRecord?: SpeechRecord[];
	message?: string;
}

/**
 * Fetch speeches for a given member from the Kokkai API (with retry)
 */
async function fetchSpeechesForMember(
	memberName: string,
	fromDate: string,
	untilDate: string,
	startRecord = 1,
	maxRetries = 3
): Promise<KokkaiSpeechResponse> {
	const params = new URLSearchParams({
		speaker: memberName,
		from: fromDate,
		until: untilDate,
		maximumRecords: '100',
		recordPacking: 'json',
		startRecord: startRecord.toString()
	});

	const url = `${KOKKAI_API_BASE}?${params.toString()}`;
	console.log(`  Fetching: ${url}`);

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetchWithRetry(url);
			if (response.status !== 200) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = (await response.json()) as KokkaiSpeechResponse;
			return data;
		} catch (error) {
			if (attempt < maxRetries - 1) {
				const delay = 1000 * Math.pow(2, attempt);
				console.warn(`  Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
				await sleep(delay);
			} else {
				throw error;
			}
		}
	}

	// This should never be reached due to throw in the loop, but TypeScript needs it
	throw new Error(`All ${maxRetries} attempts failed for ${memberName}`);
}

/**
 * Extract group affiliations from speeches
 */
function extractGroupAffiliations(speeches: SpeechRecord[]): Map<string, GroupAffiliation> {
	const groupMap = new Map<string, GroupAffiliation>();

	for (const speech of speeches) {
		const groupName = speech.speakerGroup;
		const date = speech.date;

		if (!groupName || !date) continue;

		if (groupMap.has(groupName)) {
			const affiliation = groupMap.get(groupName)!;
			affiliation.speechCount++;
			if (date < affiliation.firstDate) {
				affiliation.firstDate = date;
			}
			if (date > affiliation.lastDate) {
				affiliation.lastDate = date;
			}
		} else {
			groupMap.set(groupName, {
				groupName,
				firstDate: date,
				lastDate: date,
				speechCount: 1
			});
		}
	}

	return groupMap;
}

/**
 * Insert member-group relationship
 */
async function insertMemberGroup(
	db: DrizzleDB,
	memberId: number,
	groupId: number,
	startDate: string,
	endDate: string
): Promise<void> {
	await db.insert(schema.memberGroup).values({
		memberId,
		groupId,
		startDate,
		endDate
	});

	console.log(`  Inserted member-group: ${startDate} to ${endDate}`);
}

/**
 * Process a single member
 */
async function processMember(
	db: DrizzleDB | null,
	member: { id: number; name: string },
	fromDate: string,
	untilDate: string,
	dryRun: boolean
): Promise<void> {
	console.log(`\nProcessing member: ${member.name} (ID: ${member.id})`);

	const allSpeeches: SpeechRecord[] = [];
	let startRecord = 1;
	let hasMore = true;

	while (hasMore) {
		await sleep(DELAY_BETWEEN_REQUESTS);

		try {
			const data = await fetchSpeechesForMember(member.name, fromDate, untilDate, startRecord);

			if (data.message) {
				console.log(`  API message: ${data.message}`);
				break;
			}

			if (!data.speechRecord || data.speechRecord.length === 0) {
				console.log(`  No speeches found`);
				break;
			}

			allSpeeches.push(...data.speechRecord);
			console.log(
				`  Fetched ${data.speechRecord.length} speeches (total: ${allSpeeches.length}/${data.numberOfRecords})`
			);

			if (data.nextRecordPosition) {
				startRecord = data.nextRecordPosition;
			} else {
				hasMore = false;
			}
		} catch (error) {
			console.error(`  Error fetching speeches: ${error}`);
			break;
		}
	}

	if (allSpeeches.length === 0) {
		console.log(`  No speeches found for ${member.name}`);
		return;
	}

	const groupAffiliations = extractGroupAffiliations(allSpeeches);
	console.log(`  Found ${groupAffiliations.size} group affiliation(s)`);

	for (const [groupName, affiliation] of groupAffiliations) {
		console.log(
			`  Group: ${groupName} (${affiliation.firstDate} to ${affiliation.lastDate}, ${affiliation.speechCount} speeches)`
		);

		if (!dryRun && db) {
			const groupId = await getOrCreateGroup(db, groupName);
			await insertMemberGroup(db, member.id, groupId, affiliation.firstDate, affiliation.lastDate);
		} else {
			console.log(`  [DRY-RUN] Would create/update member-group relationship`);
		}
	}
}

async function main() {
	const args = parseArgs();
	const DRY_RUN = hasFlag(args, 'dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	// Parse positional arguments
	const fromDate = getPositionalArg(args, 0, '1947-01-01') ?? '1947-01-01';
	const untilDate =
		getPositionalArg(args, 1, new Date().toISOString().split('T')[0]) ??
		new Date().toISOString().split('T')[0];
	const memberIdFilter = getPositionalArg(args, 2, undefined);

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

	console.log(`=== Scraping Member Groups ===`);
	console.log(`Date range: ${fromDate} to ${untilDate}`);
	console.log(`Dry run: ${DRY_RUN}`);
	if (memberIdFilter) {
		console.log(`Processing only member ID: ${memberIdFilter}`);
	}

	if (DRY_RUN || !db) {
		console.log(`[DRY-RUN] Skipping database query. Use without --dry-run to process members.`);
		console.log(`\n=== Scraping Complete (Dry Run) ===`);
		return;
	}

	// Get members from the database
	let members;
	if (memberIdFilter) {
		members = await db
			.select()
			.from(schema.member)
			.where(eq(schema.member.id, parseInt(memberIdFilter)));
	} else {
		members = await db.select().from(schema.member);
	}

	console.log(`Found ${members.length} member(s) in database`);

	try {
		for (const member of members) {
			try {
				await processMember(db, member, fromDate, untilDate, DRY_RUN);
			} catch (error) {
				console.error(`Error processing member ${member.name}:`, error);
				continue;
			}
		}
	} finally {
		if (client) {
			await client.end();
		}
	}

	console.log(`\n=== Scraping Complete ===`);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
