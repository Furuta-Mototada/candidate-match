import { fetch } from 'undici';
import dotenv from 'dotenv';
dotenv.config();
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
/* eslint-disable @typescript-eslint/no-explicit-any */

const KOKKAI_API_BASE = 'https://kokkai.ndl.go.jp/api/speech';
const DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds as recommended by API docs

/**
 * Normalize a member name by removing spaces
 */
function normalizeMemberName(name: string): string {
	return name
		.replace(/\u3000/g, '') // Remove full-width space (U+3000)
		.replace(/ /g, '') // Remove half-width space
		.trim();
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch speeches for a given member from the Kokkai API
 */
async function fetchSpeechesForMember(
	memberName: string,
	fromDate: string,
	untilDate: string,
	startRecord = 1
): Promise<any> {
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

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	const data = await response.json();
	return data;
}

/**
 * Get or create a group in the database
 */
async function getOrCreateGroup(
	db: ReturnType<typeof drizzle>,
	groupName: string
): Promise<number> {
	const existingGroup = await db
		.select()
		.from(schema.group)
		.where(eq(schema.group.name, groupName));

	if (existingGroup.length > 0) {
		return existingGroup[0].id as number;
	}

	const [newGroup] = await db
		.insert(schema.group)
		.values({ name: groupName } as any)
		.returning();

	console.log(`  Created new group: ${groupName} (ID: ${newGroup.id})`);
	return newGroup.id as number;
}

/**
 * Extract group affiliations from speeches
 */
interface GroupAffiliation {
	groupName: string;
	firstDate: string;
	lastDate: string;
	speechCount: number;
}

function extractGroupAffiliations(speeches: any[]): Map<string, GroupAffiliation> {
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
 * Insert or update member-group relationship into the database.
 * This function will merge overlapping or adjacent periods for the same member-group.
 */
async function upsertMemberGroup(
	db: ReturnType<typeof drizzle>,
	memberId: number,
	groupId: number,
	newStartDate: string,
	newEndDate: string
): Promise<void> {
	// Get all existing records for this member-group combination
	const existing = await db
		.select()
		.from(schema.memberGroup)
		.where(and(eq(schema.memberGroup.memberId, memberId), eq(schema.memberGroup.groupId, groupId)));

	if (existing.length === 0) {
		// No existing record, just insert
		await db.insert(schema.memberGroup).values({
			memberId,
			groupId,
			startDate: newStartDate,
			endDate: newEndDate
		} as any);

		console.log(`  Inserted new member-group: ${newStartDate} to ${newEndDate}`);
		return;
	}

	// Check if the new period overlaps or is adjacent to any existing period
	let merged = false;
	for (const record of existing) {
		const existingStart = record.startDate as string;
		const existingEnd = record.endDate as string | null;

		// Check if periods overlap or are adjacent (within 30 days)
		const newStart = new Date(newStartDate);
		const newEnd = new Date(newEndDate);
		const oldStart = new Date(existingStart);
		const oldEnd = existingEnd ? new Date(existingEnd) : new Date('9999-12-31');

		// Calculate if periods overlap or are close (within 30 days)
		const daysBetween = Math.abs(
			Math.min(
				Math.abs(newStart.getTime() - oldEnd.getTime()),
				Math.abs(newEnd.getTime() - oldStart.getTime())
			) /
				(1000 * 60 * 60 * 24)
		);

		const overlaps =
			(newStart <= oldEnd && newEnd >= oldStart) || // Overlapping
			daysBetween <= 30; // Adjacent (within 30 days)

		if (overlaps) {
			// Merge: take the earliest start and latest end
			const mergedStart = newStart < oldStart ? newStartDate : existingStart;
			const mergedEnd = newEnd > oldEnd || !existingEnd ? newEndDate : existingEnd;

			// Update the existing record
			await db
				.update(schema.memberGroup)
				.set({
					startDate: mergedStart,
					endDate: mergedEnd
				})
				.where(eq(schema.memberGroup.id, record.id));

			console.log(
				`  Updated member-group: ${existingStart} to ${existingEnd || 'NULL'} => ${mergedStart} to ${mergedEnd}`
			);
			merged = true;
			break;
		}
	}

	if (!merged) {
		// No overlap found, insert as a new period
		await db.insert(schema.memberGroup).values({
			memberId,
			groupId,
			startDate: newStartDate,
			endDate: newEndDate
		} as any);

		console.log(`  Inserted new separate period: ${newStartDate} to ${newEndDate}`);
	}
}

/**
 * Process a single member
 */
async function processMember(
	db: ReturnType<typeof drizzle>,
	member: { id: number; name: string },
	fromDate: string,
	untilDate: string,
	dryRun: boolean
): Promise<void> {
	console.log(`\nProcessing member: ${member.name} (ID: ${member.id})`);

	const allSpeeches: any[] = [];
	let startRecord = 1;
	let hasMore = true;

	// Fetch all speeches for this member
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

	// Extract group affiliations
	const groupAffiliations = extractGroupAffiliations(allSpeeches);
	console.log(`  Found ${groupAffiliations.size} group affiliation(s)`);

	for (const [groupName, affiliation] of groupAffiliations) {
		console.log(
			`  Group: ${groupName} (${affiliation.firstDate} to ${affiliation.lastDate}, ${affiliation.speechCount} speeches)`
		);

		if (!dryRun) {
			const groupId = await getOrCreateGroup(db, groupName);
			await upsertMemberGroup(db, member.id, groupId, affiliation.firstDate, affiliation.lastDate);
		}
	}
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;
	const DRY_RUN = process.argv.includes('--dry-run');

	if (!DATABASE_URL && !DRY_RUN) {
		console.error(
			'DATABASE_URL is not set. Provide DATABASE_URL or run with --dry-run to skip DB writes.'
		);
		process.exit(1);
	}

	let client: ReturnType<typeof postgres> | null = null;
	let db: ReturnType<typeof drizzle> | null = null;

	if (!DRY_RUN && DATABASE_URL) {
		client = postgres(DATABASE_URL);
		db = drizzle(client, { schema });
	} else {
		// Create a dummy db for dry run
		const dummyClient = postgres(DATABASE_URL || 'postgresql://dummy');
		db = drizzle(dummyClient, { schema });
	}

	// Parse command line arguments
	const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
	const fromDate = args[0] || '1947-01-01'; // Start of modern Diet
	const untilDate = args[1] || new Date().toISOString().split('T')[0]; // Today
	const memberIdFilter = args[2] ? parseInt(args[2]) : null;

	console.log(`=== Scraping Member Groups ===`);
	console.log(`Date range: ${fromDate} to ${untilDate}`);
	console.log(`Dry run: ${DRY_RUN}`);
	if (memberIdFilter) {
		console.log(`Processing only member ID: ${memberIdFilter}`);
	}

	// Get all members from the database
	let members;
	if (memberIdFilter) {
		members = await db!.select().from(schema.member).where(eq(schema.member.id, memberIdFilter));
	} else {
		members = await db!.select().from(schema.member);
	}

	console.log(`Found ${members.length} member(s) in database`);

	// Process each member
	for (const member of members) {
		try {
			await processMember(db!, member, fromDate, untilDate, DRY_RUN);
		} catch (error) {
			console.error(`Error processing member ${member.name}:`, error);
			continue;
		}
	}

	console.log(`\n=== Scraping Complete ===`);

	if (client) {
		await client.end();
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
