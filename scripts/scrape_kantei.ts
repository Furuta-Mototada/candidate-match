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
import { eq } from 'drizzle-orm';
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
const MIN_CABINET_NUMBER = 90; // Only process cabinets from 第90代 onwards

/**
 * Parse a period string like "2021年10月4日～2024年10月1日" into start and end dates
 */
function parsePeriod(periodText: string): { start: string | null; end: string | null } {
	if (!periodText) return { start: null, end: null };

	// Check if this indicates "present" (現在) - if so, end date should be null
	const hasPresent = /現在|present/i.test(periodText);

	const parts = periodText
		.split(/～|〜|~/)
		.map((s) => s.trim())
		.filter(Boolean);
	const startRaw = parts[0] || '';
	const endRaw = parts[1] || '';

	const start = parseJapaneseDate(startRaw);
	let end: string | null = null;

	if (hasPresent) {
		end = null;
	} else if (endRaw) {
		end = parseJapaneseDate(endRaw);
	}
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
	const hasPresent = /現在|present/i.test(text);
	const dates: string[] = [];

	// Combined regex matching both Gregorian and era formats
	const combinedRe =
		/(?:(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日|(令和|平成|昭和)\s*(元|\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日)/g;

	let match: RegExpExecArray | null;
	while ((match = combinedRe.exec(text)) !== null && dates.length < 2) {
		if (match[1]) {
			// Gregorian format
			dates.push(match[1] + '年' + match[2] + '月' + match[3] + '日');
		} else if (match[4]) {
			// Era format
			dates.push(match[4] + match[5] + '年' + match[6] + '月' + match[7] + '日');
		}
	}

	const start = dates[0] ? parseJapaneseDate(dates[0]) : null;
	const end = hasPresent ? null : dates[1] ? parseJapaneseDate(dates[1]) : null;

	return { start, end, hasPresent };
}

interface CabinetEntry {
	text: string;
	href: string;
	period?: string;
	num: number;
}

/**
 * Scrape the cabinet list from the main index page
 */
async function scrapeCabinetList(): Promise<CabinetEntry[]> {
	console.log('Fetching main page:', ROOT_URL);
	const res = await fetchWithRetry(ROOT_URL);

	if (res.status !== 200) {
		throw new Error('Failed to fetch main page: ' + res.status);
	}

	const body = await res.text();
	const $ = load(body);

	const anchors: Array<{ text: string; href: string; period?: string }> = [];
	$('li.his-block').each((_, el) => {
		const genText = $(el).find('.his-generation').first().text().trim();
		const name =
			$(el).find('.his-name a').first().text().trim() ||
			$(el).find('.his-name').first().text().trim();
		const href = $(el).find('.his-name a').attr('href') || '';
		const period = $(el).find('.his-period').first().text().trim();
		if (genText && /第\s*\d+\s*代/.test(genText)) {
			anchors.push({ text: genText + ' ' + name, href: resolveUrl(ROOT_URL, href), period });
		}
	});

	console.log('Found ' + anchors.length + ' cabinet entries on index page');

	// Keep only cabinets >= MIN_CABINET_NUMBER
	const filtered = anchors
		.map((a) => {
			const m = a.text.match(/第\s*(\d+)\s*代/);
			const num = m ? Number(m[1]) : NaN;
			return { ...a, num };
		})
		.filter((a) => !Number.isNaN(a.num) && a.num >= MIN_CABINET_NUMBER)
		.sort((x, y) => x.num - y.num);

	console.log('Processing ' + filtered.length + ' cabinets (>= 第' + MIN_CABINET_NUMBER + '代)');
	return filtered;
}

/**
 * Process a single cabinet entry and extract PM name and dates
 */
async function processCabinetEntry(
	entry: CabinetEntry
): Promise<{ name: string; startDate: string | null; endDate: string | null } | null> {
	let startDate: string | null = null;
	let endDate: string | null = null;
	let pmName: string | null = entry.text.replace(/第\s*\d+\s*代/i, '').trim();

	// Try to extract dates from index period string first
	if (entry.period && /年/.test(entry.period) && /[～〜~]/.test(entry.period)) {
		const p = parsePeriod(entry.period);
		startDate = p.start;
		endDate = p.end;
	}

	// If href is empty or points to the index page, use what we have
	if (!entry.href || entry.href === ROOT_URL) {
		if (!pmName) {
			console.warn('Could not determine PM name from index entry');
			return null;
		}
		const name = pmName.replace(/\s+/g, '').trim();
		return { name, startDate, endDate };
	}

	// Fetch detail page
	try {
		const r = await fetchWithRetry(entry.href);
		if (r.status !== 200) {
			console.warn('Failed to fetch detail page: ' + r.status + ' ' + entry.href);
			// Fall back to index data
			if (pmName) {
				const name = pmName.replace(/\s+/g, '').trim();
				return { name, startDate, endDate };
			}
			return null;
		}

		const dbody = await r.text();
		const $$ = load(dbody);

		// Extract PM name from various sources
		const after = entry.text.replace(/第\s*\d+\s*代/i, '').trim();
		if (after) pmName = after;

		if (!pmName) {
			const docTitle = ($$('title').text() || '').trim();
			if (docTitle) pmName = docTitle.replace(/第\s*\d+\s*代/i, '').trim();
		}
		if (!pmName) {
			const h1 = $$('h1').first().text().trim();
			if (h1) pmName = h1.replace(/第\s*\d+\s*代/i, '').trim();
		}
		if (!pmName) {
			const possible = $$(':contains("内閣総理大臣")').first().text();
			if (possible) {
				pmName = possible.replace(/.*内閣総理大臣\s*/, '').trim();
			}
		}

		pmName = pmName ? pmName.replace(/^[：:\-\s]+|[：:\-\s]+$/g, '') : null;

		// If we didn't get dates from index, try to extract from detail page
		if (!startDate || !endDate) {
			const textAll = $$('body').text();
			const extracted = extractDatesFromContent(textAll);

			if (!startDate) startDate = extracted.start;
			if (!endDate && !extracted.hasPresent) endDate = extracted.end;
		}
	} catch (err) {
		console.warn('Error fetching detail page ' + entry.href + ':', err);
		// Fall back to index data
	}

	if (!pmName) {
		console.warn('Could not determine PM name for', entry.href);
		return null;
	}

	const name = pmName.replace(/\s+/g, '').trim();
	return { name, startDate, endDate };
}

/**
 * Save cabinet entry to database
 */
async function saveCabinetEntry(
	db: DrizzleDB | null,
	pmData: { name: string; startDate: string | null; endDate: string | null },
	dryRun: boolean
): Promise<void> {
	const { name, startDate, endDate } = pmData;

	console.log('Found PM: ' + name + ' (' + startDate + ' - ' + (endDate ?? 'present') + ')');

	if (dryRun || !db) {
		console.log('[dry-run] Would upsert member name=' + name);
		console.log('[dry-run] Would insert cabinet start=' + startDate + ' end=' + endDate);
		return;
	}

	// Get or create member
	const existing = await db.select().from(schema.member).where(eq(schema.member.name, name));
	let memberId: number;

	if (existing.length === 0) {
		const [ins] = await db.insert(schema.member).values({ name }).returning();
		memberId = ins.id;
		console.log('Inserted member id=' + memberId + ' name=' + name);
	} else {
		memberId = existing[0].id;
		console.log('Member exists id=' + memberId + ' name=' + name);
	}

	// Check for existing cabinet with same member and dates
	const existingCabinets = await db
		.select()
		.from(schema.cabinet)
		.where(eq(schema.cabinet.memberId, memberId));

	// Check if dates match any existing cabinet
	const exists = existingCabinets.some((c) => {
		const cs = c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : null;
		const ce = c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : null;
		return cs === startDate && ce === endDate;
	});

	if (exists) {
		console.log('Skipping: identical cabinet already exists for memberId=' + memberId);
		return;
	}

	// startDate is required by the schema
	if (!startDate) {
		console.warn('Cannot insert cabinet without startDate for memberId=' + memberId);
		return;
	}

	// Insert cabinet
	const insertedCabinet = await db
		.insert(schema.cabinet)
		.values({
			memberId,
			startDate,
			endDate: endDate || null
		})
		.returning();

	if (insertedCabinet && insertedCabinet.length > 0) {
		console.log('Inserted cabinet id=' + insertedCabinet[0].id + ' for memberId=' + memberId);
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

		// Process each cabinet entry
		for (let i = 0; i < cabinets.length; i++) {
			const entry = cabinets[i];
			console.log(
				'\n[' + (i + 1) + '/' + cabinets.length + '] Processing ' + entry.text + ' -> ' + entry.href
			);

			try {
				const pmData = await processCabinetEntry(entry);

				if (pmData) {
					await saveCabinetEntry(db, pmData, DRY_RUN);
				}
			} catch (err) {
				console.error('Error processing entry', entry.href, err);
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
