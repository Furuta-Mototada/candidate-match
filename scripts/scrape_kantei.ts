/**
 * Scrape cabinet (Prime Minister) information from kantei.go.jp
 *
 * This script:
 * 1. Fetches the historical cabinet list from the Prime Minister's Office website
 * 2. Extracts Prime Minister names and their terms of office
 * 3. Stores cabinet records in the database
 *
 * Usage:
 *   pnpm tsx scripts/scrape_kantei.ts [--dry-run]
 */

import { load } from 'cheerio';
import { inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import {
	fetchWithRetry,
	resolveUrl,
	parseArgs,
	hasFlag,
	createDbConnection,
	schema,
	parseJapaneseDate,
	type DrizzleDB
} from './lib';

// Configuration
const ROOT_URL = 'https://www.kantei.go.jp/jp/rekidainaikaku/index.html';
const MIN_CABINET_NUMBER = 43; // Only process cabinets from 第43代 onwards
const CONCURRENCY_LIMIT = 5; // Max parallel requests for detail pages

// Pre-compiled regexes for performance
const PRESENT_RE = /現在|present/i;
const PERIOD_SPLIT_RE = /～|〜|~/;
const GENERATION_RE = /第\s*\d+\s*代/;
const GENERATION_EXTRACT_RE = /第\s*(\d+)\s*代/;
const DATE_COMBINED_RE =
	/(?:(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日|(令和|平成|昭和)\s*(元|\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日)/g;
const WHITESPACE_RE = /\s+/g;
const TRIM_PUNCTUATION_RE = /^[：:\-\s]+|[：:\-\s]+$/g;

/**
 * Parse a period string like "2021年10月4日～2024年10月1日" into start and end dates
 */
function parsePeriod(periodText: string): { start: string | null; end: string | null } {
	if (!periodText) return { start: null, end: null };

	const hasPresent = PRESENT_RE.test(periodText);

	const parts = periodText
		.split(PERIOD_SPLIT_RE)
		.map((s) => s.trim())
		.filter(Boolean);
	const startRaw = parts[0] || '';
	const endRaw = parts[1] || '';

	const start = parseJapaneseDate(startRaw);
	const end = hasPresent ? null : endRaw ? parseJapaneseDate(endRaw) : null;

	return { start, end };
}

/**
 * Extract dates from page content using combined regex
 */
function extractDatesFromContent(text: string): {
	start: string | null;
	end: string | null;
	hasPresent: boolean;
} {
	const hasPresent = PRESENT_RE.test(text);
	const dates: string[] = [];

	// Reset regex lastIndex for reuse
	DATE_COMBINED_RE.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = DATE_COMBINED_RE.exec(text)) !== null && dates.length < 2) {
		if (match[1]) {
			// Gregorian format
			dates.push(`${match[1]}年${match[2]}月${match[3]}日`);
		} else if (match[4]) {
			// Era format
			dates.push(`${match[4]}${match[5]}年${match[6]}月${match[7]}日`);
		}
	}

	const start = dates[0] ? parseJapaneseDate(dates[0]) : null;
	const end = hasPresent ? null : dates[1] ? parseJapaneseDate(dates[1]) : null;

	return { start, end, hasPresent };
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

interface CabinetEntry {
	text: string;
	href: string;
	period?: string;
	num: number;
}

interface PMData {
	name: string;
	startDate: string | null;
	endDate: string | null;
}

/**
 * Scrape the cabinet list from the main index page
 */
async function scrapeCabinetList(): Promise<CabinetEntry[]> {
	console.log('Fetching main page:', ROOT_URL);
	const res = await fetchWithRetry(ROOT_URL);

	if (res.status !== 200) {
		throw new Error(`Failed to fetch main page: ${res.status}`);
	}

	const body = await res.text();
	const $ = load(body);

	const anchors: CabinetEntry[] = [];
	$('li.his-block').each((_, el) => {
		const $el = $(el);
		const genText = $el.find('.his-generation').first().text().trim();
		const name =
			$el.find('.his-name a').first().text().trim() || $el.find('.his-name').first().text().trim();
		const href = $el.find('.his-name a').attr('href') || '';
		const period = $el.find('.his-period').first().text().trim();

		const match = genText.match(GENERATION_EXTRACT_RE);
		if (match) {
			const num = Number(match[1]);
			if (num >= MIN_CABINET_NUMBER) {
				anchors.push({
					text: `${genText} ${name}`,
					href: resolveUrl(ROOT_URL, href),
					period,
					num
				});
			}
		}
	});

	// Sort by cabinet number
	anchors.sort((x, y) => x.num - y.num);

	console.log(`Found ${anchors.length} cabinet entries (>= 第${MIN_CABINET_NUMBER}代)`);
	return anchors;
}

/**
 * Process a single cabinet entry and extract PM name and dates.
 * Skips fetching detail page if we already have complete data from index.
 */
async function processCabinetEntry(entry: CabinetEntry): Promise<PMData | null> {
	let startDate: string | null = null;
	let endDate: string | null = null;
	let pmName: string | null = entry.text.replace(GENERATION_RE, '').trim();

	// Try to extract dates from index period string first
	if (entry.period && /年/.test(entry.period) && PERIOD_SPLIT_RE.test(entry.period)) {
		const p = parsePeriod(entry.period);
		startDate = p.start;
		endDate = p.end;
	}

	// Skip fetching detail page if we have complete data from index
	const hasCompleteData = pmName && startDate && (endDate || PRESENT_RE.test(entry.period || ''));

	if (hasCompleteData || !entry.href || entry.href === ROOT_URL) {
		if (!pmName) {
			console.warn('Could not determine PM name from index entry');
			return null;
		}
		return { name: pmName.replace(WHITESPACE_RE, ''), startDate, endDate };
	}

	// Fetch detail page only if needed
	try {
		const r = await fetchWithRetry(entry.href);
		if (r.status !== 200) {
			console.warn(`Failed to fetch detail page: ${r.status} ${entry.href}`);
			if (pmName) {
				return { name: pmName.replace(WHITESPACE_RE, ''), startDate, endDate };
			}
			return null;
		}

		const dbody = await r.text();
		const $$ = load(dbody);

		// Extract PM name from various sources if not already set
		if (!pmName) {
			const docTitle = $$('title').text().trim();
			if (docTitle) pmName = docTitle.replace(GENERATION_RE, '').trim();
		}
		if (!pmName) {
			const h1 = $$('h1').first().text().trim();
			if (h1) pmName = h1.replace(GENERATION_RE, '').trim();
		}
		if (!pmName) {
			const possible = $$(':contains("内閣総理大臣")').first().text();
			if (possible) {
				pmName = possible.replace(/.*内閣総理大臣\s*/, '').trim();
			}
		}

		pmName = pmName ? pmName.replace(TRIM_PUNCTUATION_RE, '') : null;

		// If we didn't get dates from index, try to extract from detail page
		if (!startDate || !endDate) {
			const textAll = $$('body').text();
			const extracted = extractDatesFromContent(textAll);

			if (!startDate) startDate = extracted.start;
			if (!endDate && !extracted.hasPresent) endDate = extracted.end;
		}
	} catch (err) {
		console.warn(`Error fetching detail page ${entry.href}:`, err);
	}

	if (!pmName) {
		console.warn('Could not determine PM name for', entry.href);
		return null;
	}

	return { name: pmName.replace(WHITESPACE_RE, ''), startDate, endDate };
}

/**
 * Batch save cabinet entries to database with member caching
 */
async function saveCabinetEntries(
	db: DrizzleDB | null,
	pmDataList: PMData[],
	dryRun: boolean
): Promise<void> {
	if (dryRun || !db) {
		for (const pmData of pmDataList) {
			console.log(
				`Found PM: ${pmData.name} (${pmData.startDate} - ${pmData.endDate ?? 'present'})`
			);
			console.log(`[dry-run] Would upsert member name=${pmData.name}`);
			console.log(`[dry-run] Would insert cabinet start=${pmData.startDate} end=${pmData.endDate}`);
		}
		return;
	}

	// Get unique names and fetch all existing members in one query
	const uniqueNames = [...new Set(pmDataList.map((p) => p.name))];
	const existingMembers = await db
		.select()
		.from(schema.member)
		.where(inArray(schema.member.name, uniqueNames));

	const memberMap = new Map(existingMembers.map((m) => [m.name, m.id]));

	// Insert missing members
	const missingNames = uniqueNames.filter((name) => !memberMap.has(name));
	if (missingNames.length > 0) {
		const insertedMembers = await db
			.insert(schema.member)
			.values(missingNames.map((name) => ({ name })))
			.returning();

		for (const m of insertedMembers) {
			memberMap.set(m.name, m.id);
			console.log(`Inserted member id=${m.id} name=${m.name}`);
		}
	}

	// Get all member IDs for cabinet lookup
	const memberIds = [...memberMap.values()];

	// Fetch all existing cabinets for these members in one query
	const existingCabinets = await db
		.select()
		.from(schema.cabinet)
		.where(inArray(schema.cabinet.memberId, memberIds));

	// Create a set of existing cabinet keys for fast lookup
	const existingCabinetKeys = new Set(
		existingCabinets.map((c) => {
			const cs = c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : null;
			const ce = c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : null;
			return `${c.memberId}:${cs}:${ce}`;
		})
	);

	// Prepare cabinets to insert
	const cabinetsToInsert: Array<{ memberId: number; startDate: string; endDate: string | null }> =
		[];

	for (const pmData of pmDataList) {
		const { name, startDate, endDate } = pmData;
		const memberId = memberMap.get(name);

		console.log(`Found PM: ${name} (${startDate} - ${endDate ?? 'present'})`);

		if (!memberId) {
			console.warn(`Member not found for ${name}`);
			continue;
		}

		if (!startDate) {
			console.warn(`Cannot insert cabinet without startDate for memberId=${memberId}`);
			continue;
		}

		const key = `${memberId}:${startDate}:${endDate}`;
		if (existingCabinetKeys.has(key)) {
			console.log(`Skipping: identical cabinet already exists for memberId=${memberId}`);
			continue;
		}

		cabinetsToInsert.push({ memberId, startDate, endDate: endDate || null });
		existingCabinetKeys.add(key); // Prevent duplicates within batch
	}

	// Batch insert cabinets
	if (cabinetsToInsert.length > 0) {
		const insertedCabinets = await db.insert(schema.cabinet).values(cabinetsToInsert).returning();

		for (const c of insertedCabinets) {
			console.log(`Inserted cabinet id=${c.id} for memberId=${c.memberId}`);
		}
	}
}

async function main() {
	const args = parseArgs();
	const DRY_RUN = hasFlag(args, 'dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	if (!DATABASE_URL && !DRY_RUN) {
		console.error(
			'DATABASE_URL is not set. Provide DATABASE_URL or run with --dry-run to skip DB writes.'
		);
		process.exit(1);
	}

	let client: { end: () => Promise<void> } | null = null;
	let db: DrizzleDB | null = null;

	if (!DRY_RUN && DATABASE_URL) {
		const conn = createDbConnection(DATABASE_URL);
		client = conn.client;
		db = conn.db;
	}

	try {
		// Fetch cabinet list
		const cabinets = await scrapeCabinetList();

		console.log(
			`\nProcessing ${cabinets.length} cabinet entries with concurrency=${CONCURRENCY_LIMIT}...`
		);

		// Process cabinet entries in parallel with concurrency limit
		const results = await runWithConcurrency(
			cabinets,
			async (entry, i) => {
				console.log(`[${i + 1}/${cabinets.length}] Processing ${entry.text}`);
				try {
					return await processCabinetEntry(entry);
				} catch (err) {
					console.error(`Error processing entry ${entry.href}:`, err);
					return null;
				}
			},
			CONCURRENCY_LIMIT
		);

		// Filter out null results
		const pmDataList = results.filter((r): r is PMData => r !== null);

		console.log(`\nSuccessfully extracted ${pmDataList.length} PM records`);

		// Batch save all entries to database
		await saveCabinetEntries(db, pmDataList, DRY_RUN);

		console.log('\nDone');
	} finally {
		if (client) await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
