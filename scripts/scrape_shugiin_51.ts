/**
 * Scrape 衆議院 51期 member information from shugiin.go.jp and Wikipedia
 *
 * This script handles the 51st term of the House of Representatives (衆議院),
 * which started on 2026/2/8 (election day) and is not yet available on kokkai.sugawarataku.net.
 *
 * Data sources:
 * - Member list with names and readings: https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/1giin.htm
 *   (paginated by あ行 through わ行: 1giin.htm through 10giin.htm)
 * - Party affiliation (by background color): https://ja.wikipedia.org/wiki/第51回衆議院議員総選挙
 *
 * Note: shugiin.go.jp shows 会派 (parliamentary caucus), NOT 政党 (political party).
 * Party info must come from Wikipedia.
 *
 * Usage:
 *   pnpm tsx scripts/scrape_shugiin_51.ts [options]
 *
 * Options:
 *   --dry-run     Parse pages but don't insert into database
 *   --verbose     Show detailed parsing output
 *
 * This script is called by scrape_kokkai_members.ts when scraping 衆議院 51期.
 */

import dotenv from 'dotenv';
dotenv.config();

import { load } from 'cheerio';
import { eq, and, inArray } from 'drizzle-orm';
import { createDbConnection, parseArgs, hasFlag, createPageCache, DrizzleDB, schema } from './lib';
import type { PageCache } from './lib/cache';

let cache: PageCache;

// Base URL for the paginated member list (1giin.htm = あ行, 2giin.htm = か行, etc.)
const BASE_URL = 'https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu';
const PAGE_COUNT = 10; // あ行(1) through わ行(10)
const DELAY = 500;
const WIKIPEDIA_URL =
	'https://ja.wikipedia.org/wiki/%E7%AC%AC51%E5%9B%9E%E8%A1%86%E8%AD%B0%E9%99%A2%E8%AD%B0%E5%93%A1%E7%B7%8F%E9%81%B8%E6%8C%99';

// Term 51 date info
const TERM_51_START_DATE = '2026-02-08'; // Election day
const TERM_51_END_DATE: string | null = null; // Ongoing term

// Wikipedia background color to party name mapping
// Colors extracted from the 第51回衆議院議員総選挙 Wikipedia page's table cells
const COLOR_TO_PARTY: Record<string, string> = {
	// 自由民主党 (green)
	'#9e9': '自由民主党',
	'#99ee99': '自由民主党',

	// 中道改革連合 (light blue)
	'#9cf': '中道改革連合',
	'#99ccff': '中道改革連合',

	// 日本維新の会 (cyan/teal)
	'#0c9': '日本維新の会',
	'#00cc99': '日本維新の会',

	// 国民民主党 (yellow)
	'#ffc': '国民民主党',
	'#ffffcc': '国民民主党',

	// 参政党 (orange)
	'#f90': '参政党',
	'#ff9900': '参政党',

	// チームみらい (teal/green)
	'#3fb': 'チームみらい',
	'#33ffbb': 'チームみらい',

	// 日本共産党 (red)
	'#f66': '日本共産党',
	'#ff6666': '日本共産党',

	// れいわ新選組 (pink)
	'#f8d': 'れいわ新選組',
	'#ff88dd': 'れいわ新選組',

	// 減税日本・ゆうこく連合 (light blue-grey / light orange)
	'#9ad': '減税日本・ゆうこく連合',
	'#99aadd': '減税日本・ゆうこく連合',
	'#fda': '減税日本・ゆうこく連合',
	'#ffddaa': '減税日本・ゆうこく連合',

	// 無所属 (white/grey)
	'#fff': '無所属',
	'#ffffff': '無所属',
	white: '無所属'
};

// Name aliases: shugiin.go.jp name → Wikipedia name
// For members whose names differ between the two sources
// (hiragana vs kanji, simplified vs traditional kanji, etc.)
const NAME_ALIASES: Record<string, string> = {
	赤澤亮正: '赤沢亮正',
	あかま二郎: '赤間二郎',
	あべ俊子: '阿部俊子',
	安藤たかお: '安藤高夫',
	内山こう: '内山航',
	うるま譲司: '漆間譲司',
	尾崎正直: '尾﨑正直',
	川崎ひでと: '川崎秀人',
	国光あやの: '国光文乃',
	こうらい啓一郎: '高麗啓一郎',
	斉藤りえ: '斉藤里恵',
	島村かおる: '島村薫',
	とかしきなおみ: '渡嘉敷奈緒美',
	中川こういち: '中川紘一',
	中村はやと: '中村勇太',
	なかやめぐ: '中谷めぐ',
	浜地雅一: '濱地雅一',
	藤沢忠盛: '藤澤忠盛',
	丸尾なつ子: '丸尾南都子',
	水野よしひこ: '水野良彦',
	森ようすけ: '森洋介',
	山本ジョージ: '山本譲司',
	早稲田ゆき: '早稲田夕季',
	渡辺真太朗: '渡邊真太朗'
};

interface ShugiinMember {
	names: string[];
	nameReading: string;
	partyName: string;
	district: string;
	electionCount: string;
}

/**
 * Clean member name - remove 君 suffix and any whitespace
 */
function cleanName(name: string): string {
	return name.replace(/\s+/g, '').replace(/君$/, '').trim();
}

/**
 * Clean reading - remove spaces
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
	if (match) return match[1].trim().toLowerCase();
	const match2 = style.match(/background:\s*([^;]+)/i);
	if (match2) return match2[1].trim().toLowerCase();
	return null;
}

/**
 * Get party name from background color
 */
function getPartyFromColor(color: string | null): string | null {
	if (!color) return null;
	const normalized = color.trim().toLowerCase();
	return COLOR_TO_PARTY[normalized] || null;
}

/**
 * Parse Wikipedia page to build a map of member names to their party.
 * Wikipedia shows elected members colored by their party.
 */
async function parseWikipediaPartyInfo(verbose: boolean = false): Promise<Map<string, string>> {
	console.log(`  Fetching party info from Wikipedia: ${WIKIPEDIA_URL}`);

	const html = await cache.fetchPage(WIKIPEDIA_URL, {
		maxRetries: 3,
		baseDelayMs: 1000,
		rateLimitMs: DELAY
	});
	if (!html) return new Map();

	const $ = load(html);
	const memberPartyMap = new Map<string, string>();

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
			const link = $td.find('a').first();
			if (link.length > 0) {
				const memberName = link
					.text()
					.trim()
					.replace(/[\s\u3000]+/g, '');
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
 * Parse all paginated member list pages from shugiin.go.jp.
 * Party info comes from Wikipedia (wikiPartyMap), not from the 会派 column.
 */
async function parseShugiinMemberPages(
	wikiPartyMap: Map<string, string>,
	verbose: boolean = false
): Promise<ShugiinMember[]> {
	const allMembers: ShugiinMember[] = [];

	for (let page = 1; page <= PAGE_COUNT; page++) {
		const url = `${BASE_URL}/${page}giin.htm`;
		console.log(`  Fetching page ${page}/${PAGE_COUNT}: ${url}`);

		const html = await cache.fetchShiftJIS(url, {
			maxRetries: 3,
			baseDelayMs: 1000,
			rateLimitMs: DELAY
		});
		if (!html) {
			console.log(`    Page ${page} not found or failed, stopping pagination`);
			break;
		}

		const $ = load(html);
		let pageCount = 0;

		// Parse the member table rows
		// Columns: 氏名 | ふりがな | 会派 | 選挙区 | 当選回数
		$('table tr').each((_, row) => {
			const cells = $(row).find('td');
			if (cells.length < 5) return;

			const nameCell = $(cells[0]).text().trim();
			const readingCell = $(cells[1]).text().trim();
			// cells[2] is 会派 (caucus) — we intentionally ignore this
			const districtCell = $(cells[3]).text().trim();
			const electionCountCell = $(cells[4]).text().trim();

			// Skip header/empty rows and malformed wrapper rows
			if (!nameCell || !readingCell) return;
			if (nameCell === '氏名' || nameCell === '議員氏名') return;
			if (nameCell.length > 30) return; // Skip concatenated header/wrapper rows

			const name = cleanName(nameCell);
			const reading = cleanReading(readingCell);
			if (!name || !reading) return;

			// Look up party from Wikipedia
			let partyName = wikiPartyMap.get(name) || '無所属';
			let matched = wikiPartyMap.has(name);

			// Try name alias if not found
			if (!matched && NAME_ALIASES[name]) {
				const alias = NAME_ALIASES[name];
				const aliasParty = wikiPartyMap.get(alias);
				if (aliasParty) {
					partyName = aliasParty;
					matched = true;
					if (verbose) {
						console.log(`    ${name} matched via alias ${alias} => ${partyName}`);
					}
				}
			}

			if (verbose) {
				if (!matched) {
					console.log(`    [NO MATCH] ${name} (${reading}) - defaulting to 無所属`);
				} else {
					console.log(`    ${name} (${reading}) - ${partyName} - ${districtCell}`);
				}
			}

			allMembers.push({
				names: [name],
				nameReading: reading,
				partyName,
				district: districtCell,
				electionCount: electionCountCell
			});

			pageCount++;
		});

		console.log(`    Found ${pageCount} members on page ${page}`);
	}

	console.log(`  Total members found: ${allMembers.length}`);
	return allMembers;
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
	shugiinMembers: ShugiinMember[]
): Promise<Map<string, number>> {
	if (shugiinMembers.length === 0) {
		return new Map();
	}

	// Create unique entries by primary name + reading
	const uniqueMembers = new Map<string, ShugiinMember>();
	for (const m of shugiinMembers) {
		const key = `${m.names[0]}|${m.nameReading}`;
		if (!uniqueMembers.has(key)) {
			uniqueMembers.set(key, m);
		}
	}

	// Query all existing members
	const existing = await db.select().from(schema.member);

	// Build lookup map from name+reading to existing member
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
	const newMembers: ShugiinMember[] = [];

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
 * Process members and insert into database
 */
async function processMembers(db: DrizzleDB, members: ShugiinMember[]): Promise<void> {
	console.log(`Processing 衆議院 51期 members (${members.length} members)`);

	const partyNames = members.map((m) => m.partyName);
	const memberMap = await batchGetOrCreateMembers(db, members);
	const partyMap = await batchGetOrCreateParties(db, partyNames);

	// Build member_party relations
	const relationsToCheck: Array<{
		memberId: number;
		partyId: number;
		chamber: '衆議院';
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
			chamber: '衆議院',
			startDate: TERM_51_START_DATE,
			endDate: TERM_51_END_DATE
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
				eq(schema.memberParty.chamber, '衆議院'),
				eq(schema.memberParty.startDate, TERM_51_START_DATE)
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
 * Main function to scrape 衆議院 51期 members
 */
export async function scrapeShugiin51(
	db: DrizzleDB | null,
	dryRun: boolean,
	verbose: boolean = false,
	externalCache?: PageCache
): Promise<{ termNumber: number; chamber: '衆議院'; memberCount: number }> {
	if (externalCache) {
		cache = externalCache;
	} else if (!cache) {
		cache = createPageCache('scrape_shugiin_51', process.argv.slice(2));
	}
	console.log('\nScraping 衆議院 51期 from shugiin.go.jp + Wikipedia...');

	const wikiPartyMap = await parseWikipediaPartyInfo(verbose);
	const members = await parseShugiinMemberPages(wikiPartyMap, verbose);

	if (dryRun) {
		console.log(`\n  [DRY RUN] Would process ${members.length} members`);

		// Show party distribution
		const partyCount = new Map<string, number>();
		members.forEach((m) => {
			partyCount.set(m.partyName, (partyCount.get(m.partyName) || 0) + 1);
		});
		console.log('  Party distribution:');
		for (const [party, count] of [...partyCount.entries()].sort((a, b) => b[1] - a[1])) {
			console.log(`    ${party}: ${count}`);
		}

		if (verbose) {
			console.log('\n  [VERBOSE] All members:');
			for (const m of members) {
				console.log(
					`    ${m.names[0]} (${m.nameReading}) - ${m.partyName} - ${m.district} - ${m.electionCount}回`
				);
			}
		}
	} else if (db) {
		await processMembers(db, members);
	}

	return {
		termNumber: 51,
		chamber: '衆議院',
		memberCount: members.length
	};
}

// Main entry point when run directly
async function main(): Promise<void> {
	const args = parseArgs();
	const dryRun = hasFlag(args, 'dry-run');
	const verbose = hasFlag(args, 'verbose');
	cache = createPageCache('scrape_shugiin_51', process.argv.slice(2));

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

		await scrapeShugiin51(db, dryRun, verbose);

		console.log('\nScraping complete!');
	} finally {
		if (client) {
			await client.end();
		}
	}
}

// Only run main if this is the entry point (ES module style)
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
	main().catch(console.error);
}
