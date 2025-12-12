/**
 * Scrape 参議院 27期 member information from sangiin.go.jp and Wikipedia
 *
 * This script handles the 27th term of the House of Councillors (参議院),
 * which started on 2025/7/20 and is not yet available on kokkai.sugawarataku.net.
 *
 * Data sources:
 * - Member list with names and readings: https://www.sangiin.go.jp/japanese/joho1/kousei/giin/219/giin.htm
 * - Party affiliation (by background color): https://ja.wikipedia.org/wiki/第27回参議院議員通常選挙
 *
 * Usage:
 *   pnpm tsx scripts/scrape_sangiin_27.ts [options]
 *
 * Options:
 *   --dry-run     Parse page but don't insert into database
 *
 * This script is called by scrape_kokkai_members.ts when scraping 参議院 27期.
 */

import dotenv from 'dotenv';
dotenv.config();

import { fetch } from 'undici';
import { load } from 'cheerio';
import { eq, and, inArray } from 'drizzle-orm';
import { createDbConnection, parseArgs, hasFlag, DrizzleDB, schema } from './lib';

const SANGIIN_MEMBERS_URL = 'https://www.sangiin.go.jp/japanese/joho1/kousei/giin/219/giin.htm';
const WIKIPEDIA_URL =
	'https://ja.wikipedia.org/wiki/%E7%AC%AC27%E5%9B%9E%E5%8F%82%E8%AD%B0%E9%99%A2%E8%AD%B0%E5%93%A1%E9%80%9A%E5%B8%B8%E9%81%B8%E6%8C%99';
const DELAY = 500;

// Term 27 date info (new term starting 2025)
// Both Term 26 and Term 27 members use these dates for their CURRENT membership
const TERM_27_START_DATE = '2025-07-20';
const TERM_27_END_DATE: string | null = null; // Ongoing term

// Used for DB lookup: Term 26 members were originally scraped with this start date
const TERM_26_DB_START_DATE = '2022-07-10';

// Wikipedia background color to party name mapping
// Colors are extracted from the Wikipedia page's table cells
// Note: Wikipedia uses different shades for the same party, so we include variations
const COLOR_TO_PARTY: Record<string, string> = {
	// 自由民主党 (green shades)
	'#9e9': '自由民主党',
	'#99ee99': '自由民主党',
	'#aaffaa': '自由民主党',
	'#afa': '自由民主党',
	'#3ca324': '自由民主党', // darker green used in Wikipedia
	'#36c200': '自由民主党', // another green variant

	// 公明党 (pink/light purple)
	'#fdf': '公明党',
	'#ffddff': '公明党',
	'#f55881': '公明党', // pink variant

	// 立憲民主党 (blue shades)
	'#ccf': '立憲民主党',
	'#ccccff': '立憲民主党',
	'#184589': '立憲民主党', // dark blue

	// 日本維新の会 (cyan/teal)
	'#0c9': '日本維新の会',
	'#00cc99': '日本維新の会',
	'#0a82dc': '日本維新の会', // blue variant
	'#01a8ec': '日本維新の会', // light blue variant
	'#87cefa': '日本維新の会', // light sky blue

	// 国民民主党 (yellow)
	'#ffc': '国民民主党',
	'#ffffcc': '国民民主党',
	'#f8bc00': '国民民主党', // golden yellow
	'#f8ea0d': '国民民主党', // bright yellow

	// 日本共産党 (red)
	'#f66': '日本共産党',
	'#ff6666': '日本共産党',
	'#db001c': '日本共産党', // dark red

	// 参政党 (orange)
	'#f90': '参政党',
	'#ff9900': '参政党',
	'#ee7300': '参政党', // orange variant

	// れいわ新選組 (light pink/salmon)
	'#ff9': 'れいわ新選組',
	'#ffff99': 'れいわ新選組',
	'#f8d': 'れいわ新選組',
	'#ff88dd': 'れいわ新選組',
	'#eb6da0': 'れいわ新選組', // pink
	'#ffc0cb': 'れいわ新選組', // pink

	// 日本保守党 (purple/magenta)
	'#c9f': '日本保守党',
	'#cc99ff': '日本保守党',
	'#0cf': '日本保守党', // cyan (used for 日本保守党 in some tables)
	'#00ccff': '日本保守党',
	'#6e126f': '日本保守党', // dark purple

	// 社会民主党 (light pink)
	'#f9c': '社会民主党',
	'#ff99cc': '社会民主党',

	// チームみらい (light blue)
	'#9cf': 'チームみらい',
	'#99ccff': 'チームみらい',
	'#3fb': 'チームみらい', // teal/green
	'#33ffbb': 'チームみらい',
	'#60bdae': 'チームみらい', // teal

	// 沖縄社会大衆党 (light cyan)
	'#cfc': '沖縄社会大衆党',
	'#ccffcc': '沖縄社会大衆党',
	'#9ff': '沖縄社会大衆党',
	'#99ffff': '沖縄社会大衆党',
	'#0ff': '沖縄社会大衆党', // cyan

	// 無所属 (white/grey)
	'#fff': '無所属',
	'#ffffff': '無所属',
	white: '無所属',
	'#ddd': '無所属',
	'#dddddd': '無所属',
	lightgrey: '無所属',
	'#0000ff': '無所属' // seems to be used for 無所属 in some tables
};

// Hardcoded name mappings for term 27 members whose names differ between
// sangiin.go.jp and Wikipedia (one-time scraping, so hardcoding is fine)
const NAME_ALIASES: Record<string, string> = {
	塩入清香: 'さや', // Wikipedia uses stage name さや
	奥田ふみよ: '奥田芙美代', // Wikipedia uses kanji version
	佐々木りえ: '佐々木理江' // Wikipedia uses kanji version
};

interface SangiinMember {
	names: string[]; // [display name, real name if different]
	nameReading: string;
	partyName: string;
	district: string;
	termEnd: string;
}

/**
 * Fetch a page with retry logic
 */
async function fetchPage(url: string, maxRetries = 3): Promise<string | null> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			await new Promise((resolve) => setTimeout(resolve, DELAY));

			const res = await fetch(url);
			if (res.status !== 200) {
				console.warn(`Failed to fetch ${url}: ${res.status}`);
				return null;
			}

			return await res.text();
		} catch (err) {
			lastError = err as Error;
			const delay = 1000 * Math.pow(2, attempt);
			console.warn(`Attempt ${attempt + 1} failed for ${url}, retrying in ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	console.error(`All ${maxRetries} attempts failed for ${url}:`, lastError);
	return null;
}

/**
 * Clean member name - extract names from format like "青木 愛" or "生稲 晃子 [佐山 晃子]"
 * Handles full-width spaces between name parts
 */
function parseMemberNames(nameCell: string): string[] {
	const names: string[] = [];

	// Check for real name in brackets
	const bracketMatch = nameCell.match(/^(.+?)\s*\[(.+?)\]$/);
	if (bracketMatch) {
		// Display name first, then real name
		const displayName = bracketMatch[1].replace(/\s+/g, '').trim();
		const realName = bracketMatch[2].replace(/\s+/g, '').trim();
		if (displayName) names.push(displayName);
		if (realName && realName !== displayName) names.push(realName);
	} else {
		// Just one name - remove extra spaces
		const name = nameCell.replace(/\s+/g, '').trim();
		if (name) names.push(name);
	}

	return names;
}

/**
 * Clean name reading - remove spaces
 */
function cleanReading(reading: string): string {
	return reading.replace(/\s+/g, '').trim();
}

/**
 * Extract background color from style attribute
 */
function extractBackgroundColor(style: string | undefined): string | null {
	if (!style) return null;
	const match = style.match(/background-color:\s*([^;]+)/i);
	if (match) {
		return match[1].trim().toLowerCase();
	}
	// Also try "background:" without "-color"
	const match2 = style.match(/background:\s*([^;]+)/i);
	if (match2) {
		return match2[1].trim().toLowerCase();
	}
	return null;
}

/**
 * Get party name from background color
 */
function getPartyFromColor(color: string | null): string | null {
	if (!color) return null;
	// Normalize color - remove spaces and convert to lowercase
	const normalizedColor = color.trim().toLowerCase();
	return COLOR_TO_PARTY[normalizedColor] || COLOR_TO_PARTY[normalizedColor.toUpperCase()] || null;
}

/**
 * Parse Wikipedia page to build a map of member names to their party
 * Wikipedia shows elected members colored by their party
 */
async function parseWikipediaPartyInfo(verbose: boolean = false): Promise<Map<string, string>> {
	console.log(`Fetching party info from Wikipedia: ${WIKIPEDIA_URL}`);

	const html = await fetchPage(WIKIPEDIA_URL);
	if (!html) {
		return new Map();
	}

	const $ = load(html);
	const memberPartyMap = new Map<string, string>();

	// Find tables in the 選挙区当選者 and 比例区当選者 sections
	// Each elected member is in a <td> with background-color indicating party
	$('table.wikitable td').each((_, td) => {
		const $td = $(td);
		const style = $td.attr('style');
		const bgColor = extractBackgroundColor(style);
		const partyName = getPartyFromColor(bgColor);

		if (verbose && bgColor && !partyName) {
			console.log(
				`  [VERBOSE] Unknown color: "${bgColor}" in cell: ${$td.text().trim().substring(0, 30)}`
			);
		}

		if (partyName) {
			// Get member name from the link inside the cell
			const link = $td.find('a').first();
			if (link.length > 0) {
				// Get the link text (member name)
				let memberName = link.text().trim();
				// Remove any spaces (full-width and half-width)
				memberName = memberName.replace(/[\s\u3000]+/g, '');

				if (memberName && memberName.length > 0) {
					if (verbose) {
						console.log(`  [VERBOSE] Wikipedia: "${memberName}" => ${partyName}`);
					}
					memberPartyMap.set(memberName, partyName);
				}
			}
		}
	});

	console.log(`  Found party info for ${memberPartyMap.size} members from Wikipedia`);
	return memberPartyMap;
}

/**
 * Parse the sangiin member list page
 * Gets names and readings, but party info comes from Wikipedia
 */
async function parseSangiinMemberList(
	wikiPartyMap: Map<string, string>,
	verbose: boolean = false
): Promise<SangiinMember[]> {
	console.log(`Fetching 参議院 member list: ${SANGIIN_MEMBERS_URL}`);

	const html = await fetchPage(SANGIIN_MEMBERS_URL);
	if (!html) {
		return [];
	}

	const $ = load(html);
	const members: SangiinMember[] = [];

	// The member table has rows with: 議員名, 読み方, 会派, 選挙区, 任期満了
	// Look for table rows in the main content
	$('table tr').each((_, row) => {
		const cells = $(row).find('td');
		if (cells.length < 5) return;

		const nameCell = $(cells[0]).text().trim();
		const readingCell = $(cells[1]).text().trim();
		// We'll get party from Wikipedia, not from sangiin site
		const districtCell = $(cells[3]).text().trim();
		const termEndCell = $(cells[4]).text().trim();

		// Skip header rows or empty rows
		if (!nameCell || !readingCell) return;

		const names = parseMemberNames(nameCell);
		const nameReading = cleanReading(readingCell);

		// Look up party from Wikipedia by any of the member's names
		// Try both original and normalized names for fuzzy matching
		let partyName = '無所属'; // Default to independent if not found
		let matchedName: string | null = null;
		let wasMatched = false;
		for (const name of names) {
			// Try original name first
			let party = wikiPartyMap.get(name);
			if (party) {
				partyName = party;
				matchedName = name;
				wasMatched = true;
				break;
			}
			// Try hardcoded alias (for names that differ between sangiin and Wikipedia)
			const aliasName = NAME_ALIASES[name];
			if (aliasName) {
				party = wikiPartyMap.get(aliasName);
				if (party) {
					partyName = party;
					matchedName = `${name} (alias: ${aliasName})`;
					wasMatched = true;
					break;
				}
			}
		}

		if (verbose) {
			if (!wasMatched) {
				console.log(
					`  [VERBOSE] No Wikipedia match for: ${names.join(' / ')} (termEnd: ${termEndCell})`
				);
			} else {
				console.log(`  [VERBOSE] Matched: ${matchedName} => ${partyName}`);
			}
		}

		if (names.length > 0 && nameReading) {
			members.push({
				names,
				nameReading,
				partyName,
				district: districtCell,
				termEnd: termEndCell
			});
		}
	});

	console.log(`  Found ${members.length} members`);
	return members;
}

/**
 * Filter members for term 27 (those whose term ends in 令和13年7月28日 = 2031-07-28)
 * Term 27 members were elected in 2025 and serve until 2031
 */
function filterTerm27Members(members: SangiinMember[]): SangiinMember[] {
	// Members elected in the 27th election have term ending in 令和13年7月28日
	return members.filter((m) => m.termEnd.includes('令和13年7月28日'));
}

/**
 * Filter members for term 26 (those whose term ends in 令和10年7月25日 = 2028-07-25)
 * Term 26 members were elected in 2022 and serve until 2028
 */
function filterTerm26Members(members: SangiinMember[]): SangiinMember[] {
	// Members elected in the 26th election have term ending in 令和10年7月25日
	return members.filter((m) => m.termEnd.includes('令和10年7月25日'));
}

/**
 * Get party info for Term 26 members from existing database records
 * Since Term 26 was already scraped from kokkai.sugawarataku.net, we use that data
 */
async function getPartyInfoFromDatabase(db: DrizzleDB): Promise<Map<string, string>> {
	const partyInfoMap = new Map<string, string>();

	// Query members with their parties from term 26
	const existingMembers = await db
		.select({
			memberNames: schema.member.names,
			partyName: schema.party.name
		})
		.from(schema.member)
		.innerJoin(schema.memberParty, eq(schema.member.id, schema.memberParty.memberId))
		.innerJoin(schema.party, eq(schema.memberParty.partyId, schema.party.id))
		.where(
			and(
				eq(schema.memberParty.chamber, '参議院'),
				eq(schema.memberParty.startDate, TERM_26_DB_START_DATE)
			)
		);

	// Build map from member name to party
	for (const record of existingMembers) {
		if (record.memberNames && Array.isArray(record.memberNames)) {
			for (const name of record.memberNames) {
				if (typeof name === 'string') {
					partyInfoMap.set(name, record.partyName);
				}
			}
		}
	}

	return partyInfoMap;
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

	const uniqueNames = [...new Set(partyNames.filter((n) => n.length > 0))];

	const existing = await db
		.select()
		.from(schema.party)
		.where(inArray(schema.party.name, uniqueNames));

	const partyMap = new Map<string, number>();
	existing.forEach((p) => partyMap.set(p.name, p.id));

	const newNames = uniqueNames.filter((name) => !partyMap.has(name));

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
 * Batch get or create members
 */
async function batchGetOrCreateMembers(
	db: DrizzleDB,
	sangiinMembers: SangiinMember[]
): Promise<Map<string, number>> {
	if (sangiinMembers.length === 0) {
		return new Map();
	}

	// Create unique entries by primary name + reading
	const uniqueMembers = new Map<string, SangiinMember>();
	for (const m of sangiinMembers) {
		const key = `${m.names[0]}|${m.nameReading}`;
		if (!uniqueMembers.has(key)) {
			uniqueMembers.set(key, m);
		}
	}

	// Query all existing members
	const existing = await db.select().from(schema.member);

	// Build lookup map
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

	const memberMap = new Map<string, number>();
	const newMembers: SangiinMember[] = [];

	for (const [key, m] of uniqueMembers) {
		const lookupKey = `${m.names[0]}|${m.nameReading}`;
		const existingMember = existingByNameAndReading.get(lookupKey);

		if (existingMember) {
			memberMap.set(key, existingMember.id);
		} else if (m.names[0]) {
			newMembers.push(m);
		}
	}

	if (newMembers.length === 0) {
		return memberMap;
	}

	// Batch insert new members
	console.log(`  Inserting ${newMembers.length} new members...`);
	const insertValues = newMembers.map((m) => ({
		names: m.names,
		nameReading: m.nameReading || null
	}));

	const inserted = await db.insert(schema.member).values(insertValues).returning();

	console.log(`  Batch inserted ${inserted.length} new members`);

	for (let i = 0; i < inserted.length; i++) {
		const member = inserted[i];
		const originalMember = newMembers[i];
		const key = `${originalMember.names[0]}|${originalMember.nameReading}`;
		memberMap.set(key, member.id);
	}

	return memberMap;
}

/**
 * Process current sangiin members (both term 26 and 27) and insert into database
 * All members get startDate=TERM_27_START_DATE and endDate=null (ongoing)
 */
async function processCurrentMembers(db: DrizzleDB, members: SangiinMember[]): Promise<void> {
	console.log(`Processing 参議院 current members (${members.length} members)`);

	const partyNames = members.map((m) => m.partyName);
	const memberMap = await batchGetOrCreateMembers(db, members);
	const partyMap = await batchGetOrCreateParties(db, partyNames);

	// Build member_party relations
	const relationsToCheck: Array<{
		memberId: number;
		partyId: number;
		chamber: '参議院';
		startDate: string | null;
		endDate: string | null;
	}> = [];

	for (const m of members) {
		const lookupKey = `${m.names[0]}|${m.nameReading}`;
		const memberId = memberMap.get(lookupKey);
		const partyId = partyMap.get(m.partyName);

		if (!memberId || !partyId) {
			continue;
		}

		relationsToCheck.push({
			memberId,
			partyId,
			chamber: '参議院',
			startDate: TERM_27_START_DATE,
			endDate: TERM_27_END_DATE
		});
	}

	if (relationsToCheck.length === 0) {
		console.log('  No relations to process');
		return;
	}

	// Check for existing relations
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
				eq(schema.memberParty.chamber, '参議院'),
				eq(schema.memberParty.startDate, TERM_27_START_DATE)
			)
		);

	const existingSet = new Set(
		existingRelations.map((r) => `${r.memberId}-${r.partyId}-${r.chamber}`)
	);

	const newRelations = relationsToCheck.filter(
		(r) => !existingSet.has(`${r.memberId}-${r.partyId}-${r.chamber}`)
	);

	const skippedCount = relationsToCheck.length - newRelations.length;

	if (newRelations.length > 0) {
		await db.insert(schema.memberParty).values(newRelations);
	}

	console.log(
		`  Created ${newRelations.length} member_party relations, skipped ${skippedCount} existing`
	);
}

/**
 * Main function to scrape current sangiin members (term 26 and 27)
 */
export async function scrapeSangiinTerm27(
	db: DrizzleDB | null,
	dryRun: boolean,
	verbose: boolean = false
): Promise<{ termNumber: number; chamber: '参議院'; memberCount: number }> {
	console.log('\nScraping 参議院 from sangiin.go.jp...');

	// First, fetch party information from Wikipedia for term 27
	console.log('  Fetching party information from Wikipedia (Term 27)...');
	const wikiPartyMap = await parseWikipediaPartyInfo(verbose);
	console.log(`  Found party info for ${wikiPartyMap.size} members`);

	// For term 26, get party info from database
	let dbPartyMap = new Map<string, string>();
	if (db) {
		console.log('  Fetching party information from database (Term 26)...');
		dbPartyMap = await getPartyInfoFromDatabase(db);
		console.log(`  Found party info for ${dbPartyMap.size} members from database`);
	}

	// Merge both party maps (Wikipedia takes precedence for term 27 members)
	const mergedPartyMap = new Map<string, string>();
	// First add DB entries (term 26)
	for (const [name, party] of dbPartyMap.entries()) {
		mergedPartyMap.set(name, party);
	}
	// Then add Wikipedia entries (term 27) - these will override if same name
	for (const [name, party] of wikiPartyMap.entries()) {
		mergedPartyMap.set(name, party);
	}

	if (verbose) {
		console.log('\n  [VERBOSE] Merged party map entries:');
		for (const [name, party] of mergedPartyMap.entries()) {
			console.log(`    "${name}" => ${party}`);
		}
	}

	// Parse the member list with party info
	const allMembers = await parseSangiinMemberList(mergedPartyMap, verbose);
	const term27Members = filterTerm27Members(allMembers);
	const term26Members = filterTerm26Members(allMembers);

	console.log(`  Total members on site: ${allMembers.length}`);
	console.log(`  Term 27 members (elected 2025): ${term27Members.length}`);
	console.log(`  Term 26 members (elected 2022): ${term26Members.length}`);
	console.log(
		`  All will use startDate=${TERM_27_START_DATE}, endDate=${TERM_27_END_DATE || 'null'}`
	);

	if (dryRun) {
		console.log(`\n  [DRY RUN] Would process ${term27Members.length} Term 27 members`);

		// Show party distribution for term 27
		const partyCount27 = new Map<string, number>();
		term27Members.forEach((m) => {
			partyCount27.set(m.partyName, (partyCount27.get(m.partyName) || 0) + 1);
		});
		console.log('  Term 27 Party distribution:');
		for (const [party, count] of partyCount27.entries()) {
			console.log(`    ${party}: ${count}`);
		}

		console.log(`\n  [DRY RUN] Would process ${term26Members.length} Term 26 members`);

		// Show party distribution for term 26
		const partyCount26 = new Map<string, number>();
		term26Members.forEach((m) => {
			partyCount26.set(m.partyName, (partyCount26.get(m.partyName) || 0) + 1);
		});
		console.log('  Term 26 Party distribution:');
		for (const [party, count] of partyCount26.entries()) {
			console.log(`    ${party}: ${count}`);
		}

		if (verbose) {
			// Show which members are marked as 無所属
			const independents27 = term27Members.filter((m) => m.partyName === '無所属');
			console.log(`\n  [VERBOSE] Term 27 members marked as 無所属 (${independents27.length}):`);
			for (const m of independents27) {
				console.log(`    ${m.names.join(' / ')} (${m.nameReading})`);
			}

			const independents26 = term26Members.filter((m) => m.partyName === '無所属');
			console.log(`\n  [VERBOSE] Term 26 members marked as 無所属 (${independents26.length}):`);
			for (const m of independents26) {
				console.log(`    ${m.names.join(' / ')} (${m.nameReading})`);
			}
		}
	} else if (db) {
		// Process all current members (both Term 26 and Term 27)
		// All get the same startDate (TERM_27_START_DATE) and endDate (null)
		const allCurrentMembers = [...term27Members, ...term26Members];
		console.log(`\n  Processing ${allCurrentMembers.length} current members...`);
		await processCurrentMembers(db, allCurrentMembers);
	}

	return {
		termNumber: 27,
		chamber: '参議院',
		memberCount: term27Members.length + term26Members.length
	};
}

// Main entry point when run directly
async function main(): Promise<void> {
	const args = parseArgs();
	const dryRun = hasFlag(args, 'dry-run');
	const verbose = hasFlag(args, 'verbose');

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error('DATABASE_URL environment variable is not set');
		console.error('(Needed even in dry-run mode to fetch Term 26 party info from database)');
		process.exit(1);
	}

	// Connect to database (needed for both dry-run and actual run to fetch Term 26 data)
	const conn = createDbConnection(databaseUrl);
	const db = conn.db;
	const client = conn.client;

	try {
		if (dryRun) {
			console.log('=== DRY RUN MODE ===\n');
		}

		await scrapeSangiinTerm27(db, dryRun, verbose);

		console.log('\nScraping complete!');
	} finally {
		await client.end();
	}
}

// Only run main if this is the entry point (ES module style)
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
	main().catch(console.error);
}
