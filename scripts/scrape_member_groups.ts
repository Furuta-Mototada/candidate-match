/**
 * Scrape member-group affiliations from the Kokkai API
 *
 * This script:
 * 1. Queries the Kokkai API for speeches by each member
 * 2. Filters speeches to ensure exact name matches (not partial matches)
 * 3. Validates speakerYomi against member's nameReading when both are available
 * 4. Determines chamber from member_party table (based on speech date) instead of nameOfHouse
 * 5. Extracts group affiliations as contiguous periods (handles A→B→A transitions correctly)
 * 6. Creates or updates member-group relationships in the database
 *
 * Key improvements:
 * - Exact name matching: Prevents 後藤茂 from matching 後藤茂之
 * - speakerYomi validation: Cross-checks readings to ensure correct member identification
 * - Chamber from member_party: Uses member's actual party affiliation to determine chamber,
 *   since members of 衆議院 can speak in 参議院 and vice versa
 * - Contiguous period tracking: Handles group transitions like 自由民主党・無所属の会→自由民主党→自由民主党・無所属の会
 *   correctly by creating separate periods instead of one merged range
 *
 * Usage:
 *   pnpm tsx scripts/scrape_member_groups.ts [fromDate] [untilDate] [memberId] [--dry-run] [--resume] [--verbose] [--clean]
 *
 * Examples:
 *   pnpm tsx scripts/scrape_member_groups.ts                           # Process all members
 *   pnpm tsx scripts/scrape_member_groups.ts 2020-01-01 2024-12-31     # With date range
 *   pnpm tsx scripts/scrape_member_groups.ts 2020-01-01 2024-12-31 123 # Single member
 *   pnpm tsx scripts/scrape_member_groups.ts --dry-run                 # Preview only
 *   pnpm tsx scripts/scrape_member_groups.ts --resume                  # Resume from checkpoint
 *   pnpm tsx scripts/scrape_member_groups.ts --clean                   # Delete existing records first
 */

import dotenv from 'dotenv';
dotenv.config();

import { eq } from 'drizzle-orm';
import {
	createDbConnection,
	batchGetOrCreateGroups,
	parseArgs,
	hasFlag,
	getPositionalArg,
	DrizzleDB,
	fetchWithRetry,
	sleep,
	ProgressTracker,
	type Chamber,
	schema
} from './lib';

// Configuration
const KOKKAI_API_BASE = 'https://kokkai.ndl.go.jp/api/speech';
const RATE_LIMIT_MS = 3000; // 3 seconds as recommended by API docs
const MAX_RECORDS_PER_REQUEST = 100;
const CHECKPOINT_PATH = '.cache/member_groups_checkpoint.json';

// Types
interface SpeechRecord {
	speechID: string; // 発言ID - for deduplication
	speaker: string; // 発言者名 - for exact matching
	speakerYomi?: string; // 発言者よみ - for reading validation
	speakerGroup: string;
	date: string;
	nameOfHouse: string; // Not used for chamber determination, but kept for reference
}

interface GroupAffiliation {
	groupName: string;
	chamber: Chamber;
	startDate: string;
	endDate: string;
	speechCount: number;
}

/**
 * Represents a single speech with its group and chamber info
 * Used for sorting and period detection
 */
interface SpeechWithChamber {
	date: string;
	groupName: string;
	chamber: Chamber;
}

interface MemberPartyRecord {
	memberId: number;
	chamber: Chamber | null;
	startDate: string | null;
	endDate: string | null;
}

interface KokkaiSpeechResponse {
	numberOfRecords: number;
	numberOfReturn: number;
	nextRecordPosition?: number;
	speechRecord?: SpeechRecord[];
	message?: string;
}

interface MemberGroupProgress {
	totalMembers: number;
	processedCount: number;
	startTime: string;
}

// CLI options
const args = parseArgs();
const options = {
	dryRun: hasFlag(args, 'dry-run'),
	resume: hasFlag(args, 'resume'),
	verbose: hasFlag(args, 'verbose'),
	clean: hasFlag(args, 'clean') // Delete existing member_group records before processing
};

function log(...messages: unknown[]): void {
	if (options.verbose) {
		console.log(...messages);
	}
}

/**
 * Normalize reading string for comparison
 * Converts katakana to hiragana and removes spaces
 */
function normalizeReading(reading: string | null | undefined): string | null {
	if (!reading) return null;
	// Convert katakana to hiragana
	return reading
		.replace(/[\u30A1-\u30F6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
		.replace(/\s+/g, '')
		.toLowerCase();
}

/**
 * Check if a speech matches the member exactly
 * - Speaker name must exactly match one of the member's names
 * - If both member.nameReading and speech.speakerYomi exist, they must match
 */
function matchesSpeech(
	speech: SpeechRecord,
	memberNames: string[],
	memberReading: string | null
): boolean {
	// Exact name match required
	const speakerName = speech.speaker?.trim();
	if (!speakerName || !memberNames.includes(speakerName)) {
		return false;
	}

	// If both readings are available, validate they match
	if (memberReading && speech.speakerYomi) {
		const normalizedMemberReading = normalizeReading(memberReading);
		const normalizedSpeakerYomi = normalizeReading(speech.speakerYomi);
		if (normalizedMemberReading && normalizedSpeakerYomi) {
			return normalizedMemberReading === normalizedSpeakerYomi;
		}
	}

	return true;
}

/**
 * Get member's chamber for a given date from pre-fetched member_party records
 * Returns the chamber if member was in a party on that date, null otherwise
 */
function getChamberForDate(
	memberPartyRecords: MemberPartyRecord[],
	speechDate: string
): Chamber | null {
	for (const record of memberPartyRecords) {
		if (!record.chamber) continue;

		const startOk = !record.startDate || record.startDate <= speechDate;
		const endOk = !record.endDate || record.endDate >= speechDate;

		if (startOk && endOk) {
			return record.chamber;
		}
	}
	return null;
}

/**
 * Fetch speeches for a member from the Kokkai API
 */
async function fetchSpeechesForMember(
	memberName: string,
	fromDate: string,
	untilDate: string,
	startRecord = 1
): Promise<KokkaiSpeechResponse> {
	const params = new URLSearchParams({
		speaker: memberName,
		from: fromDate,
		until: untilDate,
		maximumRecords: MAX_RECORDS_PER_REQUEST.toString(),
		recordPacking: 'json',
		startRecord: startRecord.toString()
	});

	const url = `${KOKKAI_API_BASE}?${params.toString()}`;
	log(`  Fetching: ${url}`);

	const response = await fetchWithRetry(url, {
		rateLimitMs: RATE_LIMIT_MS,
		maxRetries: 3,
		baseDelayMs: 1000
	});

	if (response.status !== 200) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	return (await response.json()) as KokkaiSpeechResponse;
}

/**
 * Extract group affiliations from speeches as contiguous periods
 * Uses member_party records to determine chamber based on speech date
 *
 * Key improvement: Instead of tracking just first/last date per group,
 * we track individual contiguous periods. This handles cases like:
 * 自由民主党・無所属の会 → 自由民主党 → 自由民主党・無所属の会
 * which should result in 3 separate periods, not 2 overlapping ones.
 */
function extractGroupAffiliations(
	speeches: SpeechRecord[],
	memberPartyRecords: MemberPartyRecord[]
): GroupAffiliation[] {
	// Convert speeches to SpeechWithChamber with chamber info
	const speechesWithChamber: SpeechWithChamber[] = [];

	for (const speech of speeches) {
		const groupName = speech.speakerGroup?.trim();
		const date = speech.date;

		if (!groupName || !date) continue;

		const chamber = getChamberForDate(memberPartyRecords, date);
		if (!chamber) {
			log(`  Skipping speech on ${date}: no chamber found in member_party for this date`);
			continue;
		}

		speechesWithChamber.push({ date, groupName, chamber });
	}

	if (speechesWithChamber.length === 0) {
		return [];
	}

	// Sort by date
	speechesWithChamber.sort((a, b) => a.date.localeCompare(b.date));

	// Track contiguous periods per chamber
	// Key: chamber, Value: current period info
	const currentPeriods = new Map<
		Chamber,
		{ groupName: string; startDate: string; endDate: string; speechCount: number }
	>();
	const affiliations: GroupAffiliation[] = [];

	for (const speech of speechesWithChamber) {
		const { date, groupName, chamber } = speech;
		const current = currentPeriods.get(chamber);

		if (!current) {
			// First speech in this chamber
			currentPeriods.set(chamber, { groupName, startDate: date, endDate: date, speechCount: 1 });
		} else if (current.groupName === groupName) {
			// Same group, extend the period
			current.endDate = date;
			current.speechCount++;
		} else {
			// Different group - close current period and start new one
			affiliations.push({
				groupName: current.groupName,
				chamber,
				startDate: current.startDate,
				endDate: current.endDate,
				speechCount: current.speechCount
			});
			currentPeriods.set(chamber, { groupName, startDate: date, endDate: date, speechCount: 1 });
		}
	}

	// Close any remaining periods
	for (const [chamber, period] of currentPeriods) {
		affiliations.push({
			groupName: period.groupName,
			chamber,
			startDate: period.startDate,
			endDate: period.endDate,
			speechCount: period.speechCount
		});
	}

	return affiliations;
}

/**
 * Insert member-group relationships in batch
 * Now handles multiple periods for the same group (non-overlapping)
 */
async function insertMemberGroups(
	db: DrizzleDB,
	memberId: number,
	affiliations: GroupAffiliation[],
	groupIdMap: Map<string, number>
): Promise<number> {
	const values = affiliations
		.map((aff) => {
			const key = `${aff.groupName}:${aff.chamber}`;
			const groupId = groupIdMap.get(key);
			if (!groupId) {
				console.warn(`  Warning: No group ID for ${key}`);
				return null;
			}
			return {
				memberId,
				groupId,
				startDate: aff.startDate,
				endDate: aff.endDate
			};
		})
		.filter((v): v is NonNullable<typeof v> => v !== null);

	if (values.length === 0) return 0;

	// Get all existing relationships for this member
	const existing = await db
		.select()
		.from(schema.memberGroup)
		.where(eq(schema.memberGroup.memberId, memberId));

	// Build a set of existing (groupId, startDate) pairs to check for duplicates
	// We use startDate as part of the key since the same group can have multiple periods
	const existingSet = new Set(existing.map((e) => `${e.groupId}:${e.startDate}`));
	const newValues = values.filter((v) => !existingSet.has(`${v.groupId}:${v.startDate}`));

	if (newValues.length > 0) {
		await db.insert(schema.memberGroup).values(newValues);
	}

	return newValues.length;
}

/**
 * Process a single member
 * Tries all names in the member's names array to find speeches
 * Filters speeches for exact name matches and validates speakerYomi if available
 *
 * Optimizations:
 * - Early exit if no member_party records with chamber info
 * - Deduplicate speeches by speechID across name searches
 * - Skip alternate name searches if all speeches found with primary name
 */
async function processMember(
	db: DrizzleDB | null,
	member: { id: number; names: string[]; nameReading: string | null },
	memberPartyRecords: MemberPartyRecord[],
	fromDate: string,
	untilDate: string
): Promise<{ affiliationCount: number; inserted: number }> {
	const primaryName = member.names[0];
	console.log(`\nProcessing member: ${primaryName} (ID: ${member.id})`);

	// Early exit: Check if member has any party records with chamber info
	const recordsWithChamber = memberPartyRecords.filter((r) => r.chamber !== null);
	if (recordsWithChamber.length === 0) {
		console.log(`  Skipping: No member_party records with chamber found`);
		return { affiliationCount: 0, inserted: 0 };
	}

	if (member.names.length > 1) {
		log(`  Also trying alternate names: ${member.names.slice(1).join(', ')}`);
	}
	if (member.nameReading) {
		log(`  Reading: ${member.nameReading}`);
	}

	// Use a Map to deduplicate speeches by speechID
	const speechMap = new Map<string, SpeechRecord>();
	let totalApiRecords = 0; // Track total records from API to detect if we need alternate names

	// Try each name in the member's names array
	for (const memberName of member.names) {
		let startRecord = 1;
		let hasMore = true;
		let nameApiTotal = 0;

		// Fetch all speeches with pagination for this name
		while (hasMore) {
			try {
				const data = await fetchSpeechesForMember(memberName, fromDate, untilDate, startRecord);

				if (data.message) {
					log(`  API message for "${memberName}": ${data.message}`);
					break;
				}

				if (!data.speechRecord || data.speechRecord.length === 0) {
					break;
				}

				nameApiTotal = data.numberOfRecords;

				// Filter for exact matches and validate speakerYomi
				for (const speech of data.speechRecord) {
					if (!matchesSpeech(speech, member.names, member.nameReading)) {
						continue;
					}
					// Deduplicate by speechID
					if (!speechMap.has(speech.speechID)) {
						speechMap.set(speech.speechID, speech);
					}
				}

				log(
					`  Fetched ${data.speechRecord.length} speeches for "${memberName}" (unique total: ${speechMap.size})`
				);

				if (data.nextRecordPosition) {
					startRecord = data.nextRecordPosition;
				} else {
					hasMore = false;
				}
			} catch (error) {
				console.error(`  Error fetching speeches for "${memberName}": ${error}`);
				break;
			}
		}

		totalApiRecords = Math.max(totalApiRecords, nameApiTotal);

		// Optimization: If primary name search found all matching records,
		// and we have exact matches for all API records, skip alternate names
		if (memberName === primaryName && speechMap.size === nameApiTotal && nameApiTotal > 0) {
			log(`  Primary name returned all ${nameApiTotal} matching records, skipping alternate names`);
			break;
		}
	}

	const allSpeeches = [...speechMap.values()];

	if (allSpeeches.length === 0) {
		console.log(`  No speeches found for ${primaryName} (tried ${member.names.length} name(s))`);
		return { affiliationCount: 0, inserted: 0 };
	}

	// Extract group affiliations with chamber info from member_party
	const affiliations = extractGroupAffiliations(allSpeeches, memberPartyRecords);
	console.log(
		`  Found ${affiliations.length} group affiliation period(s) from ${allSpeeches.length} speeches`
	);

	for (const aff of affiliations) {
		console.log(
			`    ${aff.chamber}: ${aff.groupName} (${aff.startDate} to ${aff.endDate}, ${aff.speechCount} speeches)`
		);
	}

	if (options.dryRun || !db) {
		console.log(`  [DRY-RUN] Would create ${affiliations.length} member-group relationship(s)`);
		return { affiliationCount: affiliations.length, inserted: 0 };
	}

	// Batch get/create groups by chamber
	const shugiinGroups = affiliations.filter((a) => a.chamber === '衆議院').map((a) => a.groupName);
	const sangiinGroups = affiliations.filter((a) => a.chamber === '参議院').map((a) => a.groupName);

	const groupIdMap = new Map<string, number>();

	if (shugiinGroups.length > 0) {
		const shugiinMap = await batchGetOrCreateGroups(db, shugiinGroups, '衆議院');
		shugiinMap.forEach((id, name) => groupIdMap.set(`${name}:衆議院`, id));
	}

	if (sangiinGroups.length > 0) {
		const sangiinMap = await batchGetOrCreateGroups(db, sangiinGroups, '参議院');
		sangiinMap.forEach((id, name) => groupIdMap.set(`${name}:参議院`, id));
	}

	// Insert member-group relationships
	const inserted = await insertMemberGroups(db, member.id, affiliations, groupIdMap);
	console.log(`  Inserted ${inserted} new member-group relationship(s)`);

	return { affiliationCount: affiliations.length, inserted };
}

async function main(): Promise<void> {
	const DATABASE_URL = process.env.DATABASE_URL;

	// Parse positional arguments
	const fromDate = getPositionalArg(args, 0, '1947-01-01') ?? '1947-01-01';
	const untilDate =
		getPositionalArg(args, 1, new Date().toISOString().split('T')[0]) ??
		new Date().toISOString().split('T')[0];
	const memberIdFilter = getPositionalArg(args, 2, undefined);

	if (!DATABASE_URL && !options.dryRun) {
		console.error('DATABASE_URL is not set. Provide DATABASE_URL or run with --dry-run.');
		process.exit(1);
	}

	let client: { end: () => Promise<void> } | null = null;
	let db: DrizzleDB | null = null;

	if (!options.dryRun && DATABASE_URL) {
		const conn = createDbConnection(DATABASE_URL);
		client = conn.client;
		db = conn.db;
	}

	console.log(`=== Scraping Member Groups ===`);
	console.log(`Date range: ${fromDate} to ${untilDate}`);
	console.log(
		`Options: dryRun=${options.dryRun}, resume=${options.resume}, verbose=${options.verbose}, clean=${options.clean}`
	);
	if (memberIdFilter) {
		console.log(`Processing only member ID: ${memberIdFilter}`);
	}

	if (options.dryRun || !db) {
		console.log(`[DRY-RUN] Skipping database query. Use without --dry-run to process members.`);
		console.log(`\n=== Scraping Complete (Dry Run) ===`);
		return;
	}

	// Clean existing member_group records if requested
	if (options.clean) {
		if (memberIdFilter) {
			await db
				.delete(schema.memberGroup)
				.where(eq(schema.memberGroup.memberId, parseInt(memberIdFilter)));
			console.log(`Deleted existing member_group records for member ID ${memberIdFilter}`);
		} else {
			await db.delete(schema.memberGroup);
			console.log(`Deleted all existing member_group records`);
		}
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

	// Pre-fetch all member_party records for efficient chamber lookup
	console.log(`Loading member_party records...`);
	const allMemberPartyRecords = await db.select().from(schema.memberParty);
	console.log(`Loaded ${allMemberPartyRecords.length} member_party records`);

	// Build a map of member ID to their party records (for efficient lookup)
	const memberPartyMap = new Map<number, MemberPartyRecord[]>();
	for (const record of allMemberPartyRecords) {
		const existing = memberPartyMap.get(record.memberId) || [];
		existing.push({
			memberId: record.memberId,
			chamber: record.chamber,
			startDate: record.startDate,
			endDate: record.endDate
		});
		memberPartyMap.set(record.memberId, existing);
	}

	// Initialize progress tracker
	const progress = new ProgressTracker<MemberGroupProgress>(CHECKPOINT_PATH, {
		totalMembers: members.length,
		processedCount: 0,
		startTime: new Date().toISOString()
	});

	// Filter already processed members if resuming
	const membersToProcess = options.resume
		? members.filter((m) => !progress.isProcessed(m.id))
		: members;

	if (options.resume && membersToProcess.length < members.length) {
		console.log(
			`Resuming: ${progress.getProcessedCount()} already processed, ${membersToProcess.length} remaining`
		);
	}

	// Track statistics
	let totalAffiliations = 0;
	let totalInserted = 0;
	let processedCount = 0;
	let errorCount = 0;

	try {
		for (const member of membersToProcess) {
			try {
				// Get member_party records for this member
				const memberPartyRecords = memberPartyMap.get(member.id) || [];

				const result = await processMember(db, member, memberPartyRecords, fromDate, untilDate);
				totalAffiliations += result.affiliationCount;
				totalInserted += result.inserted;
				processedCount++;

				// Mark as processed and save checkpoint periodically
				progress.markProcessed(member.id);
				if (processedCount % 10 === 0) {
					progress.save();
					console.log(`\n--- Progress: ${processedCount}/${membersToProcess.length} members ---\n`);
				}
			} catch (error) {
				errorCount++;
				console.error(`Error processing member ${member.names[0]}:`, error);
				// Rate limit after errors to avoid hammering the API
				await sleep(5000);
			}
		}
	} finally {
		// Save final checkpoint
		progress.save();

		if (client) {
			await client.end();
		}
	}

	console.log(`\n=== Scraping Complete ===`);
	console.log(`Processed: ${processedCount} members`);
	console.log(`Found: ${totalAffiliations} group affiliations`);
	console.log(`Inserted: ${totalInserted} new relationships`);
	console.log(`Errors: ${errorCount}`);
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
