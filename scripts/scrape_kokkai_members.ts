import dotenv from 'dotenv';
dotenv.config();

import { fetch } from 'undici';
import { load } from 'cheerio';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { createDbConnection, parseArgs, hasFlag, getPositionalInt, DrizzleDB, schema } from './lib';

const BASE_URL = 'https://kokkai.sugawarataku.net';
const DELAY = 500; // Rate limit delay between requests

// Term ranges for each house
const SHUGIIN_TERM_START = 23; // 衆議院 starts at 23期
const SHUGIIN_TERM_END = 50; // 衆議院 ends at 50期
const SANGIIN_TERM_START = 1; // 参議院 starts at 1期
const SANGIIN_TERM_END = 26; // 参議院 ends at 26期

interface TermMember {
	name: string;
	nameReading: string;
	partyName: string;
	district: string;
	electionCount: string;
	profileUrl: string;
	isByElection: boolean;
}

interface TermInfo {
	termNumber: number;
	chamber: '衆議院' | '参議院';
	startDate: string | null;
	endDate: string | null;
	members: TermMember[];
}

/**
 * Fetch with retry logic for Shift-JIS encoded pages
 */
async function fetchShiftJIS(
	url: string,
	maxRetries = 3,
	initialDelay = 1000
): Promise<string | null> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			await new Promise((resolve) => setTimeout(resolve, DELAY));

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
			const delay = initialDelay * Math.pow(2, attempt);
			console.warn(`Attempt ${attempt + 1} failed for ${url}, retrying in ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	console.error(`All ${maxRetries} attempts failed for ${url}:`, lastError);
	return null;
}

/**
 * Build URL for a term page
 * 衆議院: /giin/rl{NNN}.html (e.g., rl023.html)
 * 参議院: /giin/cl{NNN}.html (e.g., cl001.html)
 */
function buildTermUrl(chamber: '衆議院' | '参議院', termNumber: number): string {
	const prefix = chamber === '衆議院' ? 'rl' : 'cl';
	const paddedNum = termNumber.toString().padStart(3, '0');
	return `${BASE_URL}/giin/${prefix}${paddedNum}.html`;
}

/**
 * Parse date range from term info text
 * Format: "※23期範囲：1947/04/25〜1949/01/23" or "※50期範囲：2024/10/27〜" (open-ended)
 * Note: The wave dash character can be either U+301C (〜) or U+FF5E (～) depending on encoding
 */
function parseTermDateRange(html: string): { startDate: string | null; endDate: string | null } {
	// Look for the date range pattern - end date may be missing for current terms
	// Use character class to match both wave dash (〜) and fullwidth tilde (～)
	const match = html.match(/※\d+期範囲：(\d{4}\/\d{2}\/\d{2})[〜～](\d{4}\/\d{2}\/\d{2})?/);
	if (match) {
		// Convert from YYYY/MM/DD to YYYY-MM-DD for database
		const startDate = match[1].replace(/\//g, '-');
		const endDate = match[2] ? match[2].replace(/\//g, '-') : null;
		return { startDate, endDate };
	}
	return { startDate: null, endDate: null };
}

/**
 * Parse a term page and extract member information
 */
async function parseTermPage(
	chamber: '衆議院' | '参議院',
	termNumber: number
): Promise<TermInfo | null> {
	const url = buildTermUrl(chamber, termNumber);
	console.log(`Fetching ${chamber} ${termNumber}期: ${url}`);

	const html = await fetchShiftJIS(url);
	if (!html) {
		return null;
	}

	const $ = load(html);
	const { startDate, endDate } = parseTermDateRange(html);

	const members: TermMember[] = [];

	// Each member entry is in a div.zt11
	$('div.zt11').each((_, el) => {
		const $el = $(el);

		// Name reading in span.zt4
		const nameReading = $el.find('span.zt4').text().trim();

		// Name in span.zt5 > a
		const nameLink = $el.find('span.zt5 a');
		const name = nameLink.text().trim();
		const profileHref = nameLink.attr('href') || '';
		const profileUrl = profileHref ? `${BASE_URL}/giin/${profileHref}` : '';

		// Party name in div.cc2
		const partyName = $el.find('div.cc2').text().trim();

		// Election count in div.cc3
		const electionCount = $el.find('div.cc3').text().trim();

		// District in div.cc4
		const district = $el.find('div.cc4').text().trim();

		// Check for by-election marker
		const isByElection = $el.find('span.hkcolor').length > 0;

		if (name) {
			members.push({
				name,
				nameReading,
				partyName,
				district,
				electionCount,
				profileUrl,
				isByElection
			});
		}
	});

	console.log(`  Found ${members.length} members, date range: ${startDate} ~ ${endDate}`);

	return {
		termNumber,
		chamber,
		startDate,
		endDate,
		members
	};
}

/**
 * Batch get or create parties
 */
async function batchGetOrCreateParties(
	db: DrizzleDB,
	partyNames: string[]
): Promise<Map<string, number>> {
	if (partyNames.length === 0) {
		return new Map();
	}

	// Remove duplicates and filter empty
	const uniqueNames = [...new Set(partyNames.filter((n) => n.length > 0))];

	// Get existing parties
	const existing = await db
		.select()
		.from(schema.party)
		.where(inArray(schema.party.name, uniqueNames));

	const partyMap = new Map<string, number>();
	existing.forEach((p) => partyMap.set(p.name, p.id));

	// Find names that don't exist yet
	const newNames = uniqueNames.filter((name) => !partyMap.has(name));

	// Batch insert new parties
	if (newNames.length > 0) {
		const inserted = await db
			.insert(schema.party)
			.values(newNames.map((name) => ({ name })))
			.returning();

		inserted.forEach((p) => {
			partyMap.set(p.name, p.id);
			console.log(`  Inserted party: ${p.name} (ID: ${p.id})`);
		});
	}

	return partyMap;
}

/**
 * Process a term and insert data into the database
 */
async function processTerm(db: DrizzleDB, termInfo: TermInfo): Promise<void> {
	console.log(
		`Processing ${termInfo.chamber} ${termInfo.termNumber}期 (${termInfo.members.length} members)`
	);

	// Collect all unique member names and party names
	const memberNames = termInfo.members.map((m) => m.name);
	const partyNames = termInfo.members.map((m) => m.partyName);

	// Batch create members and parties
	const memberMap = await batchGetOrCreateMembersLocal(db, memberNames);
	const partyMap = await batchGetOrCreateParties(db, partyNames);

	// Build list of member_party relations to potentially insert
	const relationsToCheck: Array<{
		memberId: number;
		partyId: number;
		startDate: string | null;
		endDate: string | null;
	}> = [];

	for (const m of termInfo.members) {
		const memberId = memberMap.get(m.name);
		const partyId = partyMap.get(m.partyName);

		if (!memberId || !partyId) {
			continue;
		}

		relationsToCheck.push({
			memberId,
			partyId,
			startDate: termInfo.startDate,
			endDate: termInfo.endDate
		});
	}

	if (relationsToCheck.length === 0) {
		console.log('  No relations to process');
		return;
	}

	// Batch check for existing relations
	// Get all member_party records for these members with matching start date
	const memberIds = [...new Set(relationsToCheck.map((r) => r.memberId))];
	const existingRelations = await db
		.select({
			memberId: schema.memberParty.memberId,
			partyId: schema.memberParty.partyId,
			startDate: schema.memberParty.startDate
		})
		.from(schema.memberParty)
		.where(
			and(
				inArray(schema.memberParty.memberId, memberIds),
				termInfo.startDate
					? eq(schema.memberParty.startDate, termInfo.startDate)
					: isNull(schema.memberParty.startDate)
			)
		);

	// Create a Set of existing relations for O(1) lookup
	const existingSet = new Set(existingRelations.map((r) => `${r.memberId}-${r.partyId}`));

	// Filter out relations that already exist
	const newRelations = relationsToCheck.filter(
		(r) => !existingSet.has(`${r.memberId}-${r.partyId}`)
	);

	const skippedCount = relationsToCheck.length - newRelations.length;

	// Batch insert new relations
	if (newRelations.length > 0) {
		await db.insert(schema.memberParty).values(newRelations);
	}

	console.log(
		`  Created ${newRelations.length} member_party relations, skipped ${skippedCount} existing`
	);
}

/**
 * Batch get or create members (local version)
 */
async function batchGetOrCreateMembersLocal(
	db: DrizzleDB,
	memberNames: string[]
): Promise<Map<string, number>> {
	if (memberNames.length === 0) {
		return new Map();
	}

	// Remove duplicates
	const uniqueNames = [...new Set(memberNames)];

	// Get existing members
	const existing = await db
		.select()
		.from(schema.member)
		.where(inArray(schema.member.name, uniqueNames));

	const memberMap = new Map<string, number>();
	existing.forEach((m) => memberMap.set(m.name, m.id));

	// Find names that don't exist yet
	const newNames = uniqueNames.filter((name) => !memberMap.has(name));

	// Batch insert new members
	if (newNames.length > 0) {
		const inserted = await db
			.insert(schema.member)
			.values(newNames.map((name) => ({ name })))
			.returning();

		inserted.forEach((m) => {
			memberMap.set(m.name, m.id);
			console.log(`  Inserted member: ${m.name} (ID: ${m.id})`);
		});
	}

	return memberMap;
}

/**
 * Scrape all terms for a given chamber
 */
async function scrapeChamber(
	db: DrizzleDB | null,
	chamber: '衆議院' | '参議院',
	startTerm: number,
	endTerm: number,
	dryRun: boolean
): Promise<void> {
	console.log(`\nScraping ${chamber} from ${startTerm}期 to ${endTerm}期...`);

	for (let term = startTerm; term <= endTerm; term++) {
		const termInfo = await parseTermPage(chamber, term);
		if (!termInfo) {
			console.warn(`  Failed to parse ${chamber} ${term}期`);
			continue;
		}

		if (dryRun) {
			console.log(`  [DRY RUN] Would process ${termInfo.members.length} members`);

			// Show sample of parties found
			const parties = [...new Set(termInfo.members.map((m) => m.partyName))].filter(
				(p) => p.length > 0
			);
			console.log(`  Parties: ${parties.join(', ')}`);
		} else if (db) {
			await processTerm(db, termInfo);
		}
	}
}

function printUsage(): void {
	console.log(`
Usage: npx tsx scripts/scrape_kokkai_members.ts [options] [start_term] [end_term]

Options:
  --dry-run     Parse pages but don't insert into database
  --shugiin     Only scrape 衆議院 (House of Representatives)
  --sangiin     Only scrape 参議院 (House of Councillors)
  --help        Show this help message

Arguments:
  start_term    Starting term number (default: 23 for 衆議院, 1 for 参議院)
  end_term      Ending term number (default: 50 for 衆議院, 26 for 参議院)

Examples:
  npx tsx scripts/scrape_kokkai_members.ts --dry-run
  npx tsx scripts/scrape_kokkai_members.ts --shugiin 45 50
  npx tsx scripts/scrape_kokkai_members.ts --sangiin 20 26

Data source: https://kokkai.sugawarataku.net/ (国会議員白書)
  `);
}

async function main(): Promise<void> {
	const args = parseArgs();

	if (hasFlag(args, 'help')) {
		printUsage();
		return;
	}

	const dryRun = hasFlag(args, 'dry-run');
	const shugiinOnly = hasFlag(args, 'shugiin');
	const sangiinOnly = hasFlag(args, 'sangiin');

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl && !dryRun) {
		console.error('DATABASE_URL environment variable is not set');
		process.exit(1);
	}

	let db: DrizzleDB | null = null;
	let client: ReturnType<typeof createDbConnection>['client'] | null = null;

	if (!dryRun && databaseUrl) {
		const conn = createDbConnection(databaseUrl);
		db = conn.db;
		client = conn.client;
	}

	try {
		if (dryRun) {
			console.log('=== DRY RUN MODE ===\n');
		}

		// Scrape 衆議院
		if (!sangiinOnly) {
			const startTerm = getPositionalInt(args, 0) ?? SHUGIIN_TERM_START;
			const endTerm = getPositionalInt(args, 1) ?? SHUGIIN_TERM_END;
			await scrapeChamber(db, '衆議院', startTerm, endTerm, dryRun);
		}

		// Scrape 参議院
		if (!shugiinOnly) {
			const startTerm = sangiinOnly
				? (getPositionalInt(args, 0) ?? SANGIIN_TERM_START)
				: SANGIIN_TERM_START;
			const endTerm = sangiinOnly
				? (getPositionalInt(args, 1) ?? SANGIIN_TERM_END)
				: SANGIIN_TERM_END;
			await scrapeChamber(db, '参議院', startTerm, endTerm, dryRun);
		}

		console.log('\nScraping complete!');
	} finally {
		if (client) {
			await client.end();
		}
	}
}

main().catch(console.error);
