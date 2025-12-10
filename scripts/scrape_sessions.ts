import dotenv from 'dotenv';
dotenv.config();

import * as cheerio from 'cheerio';
import * as schema from '../src/lib/server/db/schema';
import { sql } from 'drizzle-orm';
import { createDbConnection, parseArgs, hasFlag, parseJapaneseDate, DrizzleDB } from './lib';

const SESSIONS_URL =
	'https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/kaiki.htm';

type SessionType = '常会' | '臨時会' | '特別会';

interface ParsedSession {
	sessionNumber: number;
	sessionType: SessionType;
	startDate: string;
	endDate: string | null;
}

/**
 * Fetch Shift-JIS encoded page
 */
async function fetchShiftJIS(url: string): Promise<string> {
	const res = await fetch(url);
	if (res.status !== 200) {
		throw new Error(`HTTP error! status: ${res.status}`);
	}
	const buffer = await res.arrayBuffer();
	const decoder = new TextDecoder('shift-jis');
	return decoder.decode(buffer);
}

/**
 * Parse session type from Japanese text
 */
function parseSessionType(text: string): SessionType | null {
	if (text.includes('常会')) return '常会';
	if (text.includes('臨時会')) return '臨時会';
	if (text.includes('特別会')) return '特別会';
	return null;
}

/**
 * Parse end date, handling dissolution cases
 * e.g., "令和6年10月9日 解散" or "（令和6年10月9日 解散）"
 */
function parseEndDate(text: string): string | null {
	// Remove parentheses and whitespace
	const cleaned = text.replace(/[（）()]/g, '').trim();

	// Try to parse the date (it may contain 解散 after the date)
	const date = parseJapaneseDate(cleaned);
	return date;
}

/**
 * Scrape session data from the Shugiin website
 */
async function scrapeSessions(): Promise<ParsedSession[]> {
	console.log(`Fetching sessions from ${SESSIONS_URL}`);

	const html = await fetchShiftJIS(SESSIONS_URL);
	const $ = cheerio.load(html);

	const sessions: ParsedSession[] = [];

	// Find all tables with session data
	$('table tr').each((_, row) => {
		const cells = $(row).find('td');
		if (cells.length < 3) return;

		const firstCell = $(cells[0]).text().trim();
		const secondCell = $(cells[1]).text().trim();
		const thirdCell = $(cells[2]).text().trim();

		// Check if first cell contains session info like "第219回（臨時会）" or "第127回 （特別会）"
		const sessionMatch = firstCell.match(/第\s*(\d+)\s*回\s*[（(]([^）)]+)[）)]/);
		if (!sessionMatch) return;

		const sessionNumber = parseInt(sessionMatch[1]);
		const sessionType = parseSessionType(sessionMatch[2]);

		if (!sessionType) {
			console.warn(`  Unknown session type: ${sessionMatch[2]} for session ${sessionNumber}`);
			return;
		}

		// Parse start date (second cell)
		const startDate = parseJapaneseDate(secondCell);
		if (!startDate) {
			console.warn(`  Could not parse start date: ${secondCell} for session ${sessionNumber}`);
			return;
		}

		// Parse end date (third cell) - may be null for dissolved sessions
		const endDate = parseEndDate(thirdCell);

		sessions.push({
			sessionNumber,
			sessionType,
			startDate,
			endDate
		});
	});

	// Sort by session number descending (newest first)
	sessions.sort((a, b) => b.sessionNumber - a.sessionNumber);

	return sessions;
}

/**
 * Save all sessions to database using batch upsert
 */
async function saveSessions(db: DrizzleDB, sessions: ParsedSession[]): Promise<void> {
	if (sessions.length === 0) return;

	// Batch upsert using onConflictDoUpdate
	await db
		.insert(schema.congressSession)
		.values(
			sessions.map((session) => ({
				sessionNumber: session.sessionNumber,
				sessionType: session.sessionType,
				startDate: session.startDate,
				endDate: session.endDate
			}))
		)
		.onConflictDoUpdate({
			target: schema.congressSession.sessionNumber,
			set: {
				sessionType: sql`excluded.session_type`,
				startDate: sql`excluded.start_date`,
				endDate: sql`excluded.end_date`
			}
		});
}

async function main() {
	const args = parseArgs();
	const DRY_RUN = hasFlag(args, 'dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

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

	console.log(`=== Scraping Congress Sessions ===`);
	console.log(`Dry run: ${DRY_RUN}`);

	try {
		const sessions = await scrapeSessions();
		console.log(`\nFound ${sessions.length} sessions`);

		// Show first few and last few
		console.log(`\nNewest sessions:`);
		sessions.slice(0, 5).forEach((s) => {
			console.log(
				`  Session ${s.sessionNumber} (${s.sessionType}): ${s.startDate} to ${s.endDate || 'dissolved'}`
			);
		});

		console.log(`\nOldest sessions:`);
		sessions.slice(-3).forEach((s) => {
			console.log(
				`  Session ${s.sessionNumber} (${s.sessionType}): ${s.startDate} to ${s.endDate || 'dissolved'}`
			);
		});

		if (!DRY_RUN && db) {
			console.log(`\nSaving to database...`);
			await saveSessions(db, sessions);
			console.log(`Saved ${sessions.length} sessions to database`);
		} else {
			console.log(`\n[DRY-RUN] Would save ${sessions.length} sessions to database`);
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
