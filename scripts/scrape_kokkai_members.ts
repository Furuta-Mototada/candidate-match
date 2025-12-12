/**
 * Scrape Diet member information from 国会議員白書 (kokkai.sugawarataku.net)
 *
 * This script:
 * 1. Fetches member listings for each term (期) from both houses
 * 2. Extracts member names, party affiliations, and districts
 * 3. Creates member and party records, linking them with member_party relations
 *
 * Usage:
 *   pnpm tsx scripts/scrape_kokkai_members.ts [options] [start_term] [end_term]
 *
 * Options:
 *   --dry-run     Parse pages but don't insert into database
 *   --shugiin     Only scrape 衆議院 (House of Representatives)
 *   --sangiin     Only scrape 参議院 (House of Councillors)
 *
 * Examples:
 *   pnpm tsx scripts/scrape_kokkai_members.ts --dry-run
 *   pnpm tsx scripts/scrape_kokkai_members.ts --shugiin 45 50
 *   pnpm tsx scripts/scrape_kokkai_members.ts --sangiin 20 27
 *
 * Data sources:
 *   - https://kokkai.sugawarataku.net/ (国会議員白書) for terms up to 参議院 26期
 *   - https://www.sangiin.go.jp/ for 参議院 27期 onwards
 */

import dotenv from 'dotenv';
dotenv.config();

import { fetch } from 'undici';
import { load } from 'cheerio';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { createDbConnection, parseArgs, hasFlag, getPositionalInt, DrizzleDB, schema } from './lib';
import { scrapeSangiinTerm27 } from './scrape_sangiin_27';

const BASE_URL = 'https://kokkai.sugawarataku.net';
const DELAY = 500; // Rate limit delay between requests

// Term ranges for each house
const SHUGIIN_TERM_START = 23; // 衆議院 starts at 23期
const SHUGIIN_TERM_END = 50; // 衆議院 ends at 50期
const SANGIIN_TERM_START = 1; // 参議院 starts at 1期
const SANGIIN_TERM_END_KOKKAI = 26; // 参議院 ends at 26期 on kokkai.sugawarataku.net
const SANGIIN_TERM_END = 27; // 参議院 27期 is available from sangiin.go.jp

// Term 27 started on 2025-07-20, so Term 26 should end on this date
const SANGIIN_TERM_27_START_DATE = '2025-07-20';

interface TermMember {
	names: string[]; // Multiple names (e.g., ["赤間二郎", "あかま二郎"])
	nameReading: string; // Reading in hiragana (e.g., "あかまじろう")
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
 * Clean a member name by removing parenthetical reading hints
 * e.g., "金子恵美（めぐみ）" → "金子恵美"
 */
function cleanMemberName(name: string): string {
	// Remove parenthetical content (both full-width and half-width parentheses)
	return name.replace(/[（(][^）)]*[）)]/g, '').trim();
}

/**
 * Fetch member profile page and extract all name variations from 基本情報 section
 * e.g., "赤間二郎、あかま二郎" → ["赤間二郎", "あかま二郎"]
 */
async function fetchMemberNamesFromProfile(profileUrl: string): Promise<string[]> {
	if (!profileUrl) {
		return [];
	}

	const html = await fetchShiftJIS(profileUrl);
	if (!html) {
		return [];
	}

	const $ = load(html);
	const names: string[] = [];

	// Find the 基本情報 section - structure is:
	// <div class="jt0"><div class="jt1">名前</div><div class="jt2">赤間二郎、あかま二郎</div></div>
	$('div.jt0').each((_, el) => {
		const label = $(el).find('div.jt1').text().trim();
		if (label === '名前') {
			const namesText = $(el).find('div.jt2').text().trim();
			// Split by Japanese comma (、) or regular comma
			const nameParts = namesText.split(/[、,]/).map((n) => cleanMemberName(n.trim()));
			for (const name of nameParts) {
				if (name && !names.includes(name)) {
					names.push(name);
				}
			}
		}
	});

	return names;
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

		// Name reading in span.zt4 (e.g., "あかまじろう")
		const nameReading = $el.find('span.zt4').text().trim();

		// Name in span.zt5 > a
		const nameLink = $el.find('span.zt5 a');
		const rawName = nameLink.text().trim();
		const profileHref = nameLink.attr('href') || '';
		const profileUrl = profileHref ? `${BASE_URL}/giin/${profileHref}` : '';

		// Clean the name (remove parenthetical hints like "金子恵美（めぐみ）" → "金子恵美")
		const name = cleanMemberName(rawName);

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
				names: [name], // Start with the name from this term; profile fetch will add more
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

	// Collect party names
	const partyNames = termInfo.members.map((m) => m.partyName);

	// Batch create members and parties
	const memberMap = await batchGetOrCreateMembersLocal(db, termInfo.members);
	const partyMap = await batchGetOrCreateParties(db, partyNames);

	// Build list of member_party relations to potentially insert
	const relationsToCheck: Array<{
		memberId: number;
		partyId: number;
		chamber: '衆議院' | '参議院';
		startDate: string | null;
		endDate: string | null;
	}> = [];

	for (const m of termInfo.members) {
		// Create lookup key: primary name + reading
		const lookupKey = `${m.names[0]}|${m.nameReading}`;
		const memberId = memberMap.get(lookupKey);
		const partyId = partyMap.get(m.partyName);

		if (!memberId || !partyId) {
			continue;
		}

		relationsToCheck.push({
			memberId,
			partyId,
			chamber: termInfo.chamber,
			startDate: termInfo.startDate,
			endDate: termInfo.endDate
		});
	}

	if (relationsToCheck.length === 0) {
		console.log('  No relations to process');
		return;
	}

	// Batch check for existing relations
	// Get all member_party records for these members with matching start date and chamber
	const memberIds = [...new Set(relationsToCheck.map((r) => r.memberId))];
	const existingRelations = await db
		.select({
			memberId: schema.memberParty.memberId,
			partyId: schema.memberParty.partyId,
			chamber: schema.memberParty.chamber,
			startDate: schema.memberParty.startDate
		})
		.from(schema.memberParty)
		.where(
			and(
				inArray(schema.memberParty.memberId, memberIds),
				eq(schema.memberParty.chamber, termInfo.chamber),
				termInfo.startDate
					? eq(schema.memberParty.startDate, termInfo.startDate)
					: isNull(schema.memberParty.startDate)
			)
		);

	// Create a Set of existing relations for O(1) lookup (include chamber in key)
	const existingSet = new Set(
		existingRelations.map((r) => `${r.memberId}-${r.partyId}-${r.chamber}`)
	);

	// Filter out relations that already exist
	const newRelations = relationsToCheck.filter(
		(r) => !existingSet.has(`${r.memberId}-${r.partyId}-${r.chamber}`)
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
 * Fetch multiple member profiles in parallel with concurrency limit
 */
async function batchFetchMemberProfiles(
	members: Array<{ names: string[]; nameReading: string; profileUrl: string }>,
	concurrency = 5
): Promise<Map<string, string[]>> {
	const results = new Map<string, string[]>();

	// Process in batches to limit concurrency
	for (let i = 0; i < members.length; i += concurrency) {
		const batch = members.slice(i, i + concurrency);
		const promises = batch.map(async (m) => {
			const key = `${m.names[0]}|${m.nameReading}`;
			if (m.profileUrl) {
				const profileNames = await fetchMemberNamesFromProfile(m.profileUrl);
				if (profileNames.length > 0) {
					return { key, names: profileNames };
				}
			}
			return { key, names: m.names };
		});

		const batchResults = await Promise.all(promises);
		for (const result of batchResults) {
			results.set(result.key, result.names);
		}
	}

	return results;
}

/**
 * Batch get or create members (local version)
 * Matches by BOTH name AND nameReading together.
 * - Same name + same reading = same person
 * - Same name + different reading = different people
 * - Same reading + different name = different people
 * Only fetches profile page to get additional names when creating a NEW member.
 * Returns a Map of "primaryName|reading" to member ID
 */
async function batchGetOrCreateMembersLocal(
	db: DrizzleDB,
	termMembers: TermMember[]
): Promise<Map<string, number>> {
	if (termMembers.length === 0) {
		return new Map();
	}

	// Create unique entries by primary name + reading combination
	const uniqueMembers = new Map<string, TermMember>();
	for (const m of termMembers) {
		const key = `${m.names[0]}|${m.nameReading}`;
		if (!uniqueMembers.has(key)) {
			uniqueMembers.set(key, m);
		}
	}

	// Query all existing members
	const existing = await db.select().from(schema.member);

	// Build map of "name|reading" -> member for existing members
	// A member can have multiple names, so we create entries for each name
	const existingByNameAndReading = new Map<
		string,
		{ id: number; names: string[]; nameReading: string | null }
	>();
	existing.forEach((m) => {
		for (const name of m.names) {
			const key = `${name}|${m.nameReading || ''}`;
			existingByNameAndReading.set(key, { id: m.id, names: m.names, nameReading: m.nameReading });
		}
	});

	// Result map: "primaryName|reading" -> memberId
	const memberMap = new Map<string, number>();

	// Members that need to be inserted
	const newMembers: Array<{ names: string[]; nameReading: string; profileUrl: string }> = [];

	for (const [key, m] of uniqueMembers) {
		// Try to find existing member by name + reading
		const lookupKey = `${m.names[0]}|${m.nameReading}`;
		const existingMember = existingByNameAndReading.get(lookupKey);

		if (existingMember) {
			// Member exists - add to result map
			memberMap.set(key, existingMember.id);
		} else if (m.names[0]) {
			// New member - will fetch profile page later
			newMembers.push({
				names: m.names,
				nameReading: m.nameReading,
				profileUrl: m.profileUrl
			});
		}
	}

	if (newMembers.length === 0) {
		return memberMap;
	}

	// Batch fetch all profile pages in parallel
	console.log(`  Fetching ${newMembers.length} member profiles in parallel...`);
	const profileNamesMap = await batchFetchMemberProfiles(newMembers);

	// Prepare batch insert values
	const insertValues = newMembers.map((m) => {
		const key = `${m.names[0]}|${m.nameReading}`;
		const names = profileNamesMap.get(key) || m.names;
		return {
			names,
			nameReading: m.nameReading || null
		};
	});

	// Batch insert all new members in a single query
	const inserted = await db.insert(schema.member).values(insertValues).returning();

	console.log(`  Batch inserted ${inserted.length} new members`);

	// Update maps with inserted members
	for (let i = 0; i < inserted.length; i++) {
		const member = inserted[i];
		const originalMember = newMembers[i];
		const key = `${originalMember.names[0]}|${originalMember.nameReading}`;

		memberMap.set(key, member.id);

		// Also add to existingByNameAndReading so subsequent lookups work
		for (const name of member.names) {
			const lookupKey = `${name}|${member.nameReading || ''}`;
			existingByNameAndReading.set(lookupKey, {
				id: member.id,
				names: member.names,
				nameReading: member.nameReading
			});
		}
	}

	return memberMap;
}

/**
 * Scrape all terms for a given chamber
 * For 参議院, terms up to 26 use kokkai.sugawarataku.net
 * Term 27 onwards use the dedicated sangiin.go.jp scraper
 */
async function scrapeChamber(
	db: DrizzleDB | null,
	chamber: '衆議院' | '参議院',
	startTerm: number,
	endTerm: number,
	dryRun: boolean
): Promise<void> {
	console.log(`\nScraping ${chamber} from ${startTerm}期 to ${endTerm}期...`);

	// Determine the actual end term for kokkai.sugawarataku.net
	const kokkaiEndTerm = chamber === '参議院' ? Math.min(endTerm, SANGIIN_TERM_END_KOKKAI) : endTerm;

	// Scrape from kokkai.sugawarataku.net for terms up to kokkaiEndTerm
	for (let term = startTerm; term <= kokkaiEndTerm; term++) {
		const termInfo = await parseTermPage(chamber, term);
		if (!termInfo) {
			console.warn(`  Failed to parse ${chamber} ${term}期`);
			continue;
		}

		// Override endDate for 参議院 26期 since Term 27 has started
		if (chamber === '参議院' && term === 26 && termInfo.endDate === null) {
			termInfo.endDate = SANGIIN_TERM_27_START_DATE;
			console.log(`  Overriding endDate for 参議院 26期 to ${SANGIIN_TERM_27_START_DATE}`);
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

	// For 参議院 27期 onwards, use the dedicated scraper
	if (chamber === '参議院' && endTerm >= 27 && startTerm <= 27) {
		await scrapeSangiinTerm27(db, dryRun);
	}
}

async function main(): Promise<void> {
	const args = parseArgs();

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
