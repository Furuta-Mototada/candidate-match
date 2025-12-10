#!/usr/bin/env tsx
/**
 * Scrape debate records using hourei.ndl.go.jp
 *
 * This script:
 * 1. Searches for each bill on hourei.ndl.go.jp
 * 2. Extracts the deliberation history which contains exact meeting links
 * 3. Fetches speech content from kokkai.ndl.go.jp using those links
 * 4. Stores debates in the bill_debates table
 *
 * Usage:
 *   pnpm scrape:debates --limit 10 --skip-existing --verbose
 *   pnpm scrape:debates --dry-run
 *   pnpm scrape:debates --bill-id 123
 */

import dotenv from 'dotenv';
dotenv.config();

import { chromium, type Page } from 'playwright';
import { eq, sql, inArray } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';
import {
	createDbConnection,
	parseArgs,
	hasFlag,
	getValue,
	ProgressTracker,
	DrizzleDB
} from './lib';

// Configuration
const KOKKAI_API_BASE = 'https://kokkai.ndl.go.jp/api';
const HOUREI_BASE = 'https://hourei.ndl.go.jp';
const REQUEST_DELAY = 500;

// Types
interface DeliberationRecord {
	sessionNumber: string;
	chamber: string;
	committee: string;
	meetingNumber: string;
	date: string;
	activity: string;
	pageRange: string;
	kokkaiUrl: string;
	pdfUrl: string;
}

interface HoureiBillInfo {
	lawId?: string;
	billId?: string;
	lawNumber: string;
	lawName: string;
	billName: string;
	submissionSession: string;
	deliberations: DeliberationRecord[];
}

interface KokkaiSpeech {
	speechID: string;
	issueID: string;
	session: number;
	nameOfHouse: string;
	nameOfMeeting: string;
	issue: string;
	date: string;
	speaker: string;
	speakerGroup: string;
	speakerPosition: string;
	speakerRole: string;
	speechOrder: number;
	speech: string;
	speechURL: string;
}

interface DebateProgress {
	processedBillIds: number[];
	lastBillId: number;
}

// Parse CLI arguments
const args = parseArgs();
const options = {
	limit: parseInt(getValue(args, 'limit') || '0') || Infinity,
	skipExisting: hasFlag(args, 'skip-existing'),
	verbose: hasFlag(args, 'verbose'),
	billId: parseInt(getValue(args, 'bill-id') || '0') || null,
	dryRun: hasFlag(args, 'dry-run'),
	resume: hasFlag(args, 'resume')
};

function log(...messages: unknown[]) {
	if (options.verbose) {
		console.log(...messages);
	}
}

// Search hourei.ndl.go.jp for a bill by name
async function searchHoureiBills(
	page: Page,
	keyword: string,
	sessionNumber?: number
): Promise<Array<{ lawId?: string; billId?: string; name: string; session?: string }>> {
	try {
		await page.goto(`${HOUREI_BASE}/simple/`, { waitUntil: 'networkidle' });

		const searchQuery = sessionNumber ? `${keyword} 第${sessionNumber}回` : keyword;
		await page.fill('input#fw', searchQuery);
		await page.click('button[name="searchFreeword"]');
		await page.waitForLoadState('networkidle');

		const allResults: Array<{ lawId?: string; billId?: string; name: string; session?: string }> =
			[];
		let hasNextPage = true;
		let pageNum = 1;
		const maxPages = 10;

		while (hasNextPage && pageNum <= maxPages) {
			const pageResults = await page.evaluate(() => {
				const items: Array<{ lawId?: string; billId?: string; name: string; session?: string }> =
					[];
				const listItems = document.querySelectorAll('section li h3 a');

				for (const link of listItems) {
					const href = link.getAttribute('href') || '';
					const lawIdMatch = href.match(/lawId=(\d+)/);
					const billIdMatch = href.match(/billId=(\d+)/);

					if (lawIdMatch || billIdMatch) {
						const description = (link.closest('li')?.querySelector('p')?.textContent || '').trim();
						const sessionMatch = description.match(/第(\d+)回国会/);
						items.push({
							lawId: lawIdMatch ? lawIdMatch[1] : undefined,
							billId: billIdMatch ? billIdMatch[1] : undefined,
							name: link.textContent?.trim() || '',
							session: sessionMatch ? `第${sessionMatch[1]}回国会` : undefined
						});
					}
				}
				return items;
			});

			allResults.push(...pageResults);

			const nextButton = page
				.locator('a.page-link:has-text("次へ"), button:has-text("次へ")')
				.first();
			const nextButtonVisible = await nextButton.isVisible().catch(() => false);

			if (nextButtonVisible) {
				await nextButton.click();
				await page.waitForLoadState('networkidle');
				pageNum++;
			} else {
				hasNextPage = false;
			}
		}

		log(`    Searched ${pageNum} page(s), found ${allResults.length} total results`);
		return allResults;
	} catch (error) {
		console.error('Error searching hourei:', error);
		return [];
	}
}

// Fetch bill details and deliberation history from hourei.ndl.go.jp
async function fetchHoureiBillDetails(
	page: Page,
	id: string,
	type: 'lawId' | 'billId'
): Promise<HoureiBillInfo | null> {
	try {
		const url =
			type === 'lawId'
				? `${HOUREI_BASE}/simple/detail?lawId=${id}`
				: `${HOUREI_BASE}/simple/detail?billId=${id}&searchDiv=2`;

		log(`  Fetching: ${url}`);
		await page.goto(url, { waitUntil: 'networkidle' });

		const getText = async (label: string): Promise<string> => {
			const spans = await page.locator('span').all();
			for (const span of spans) {
				const text = await span.textContent();
				if (text && text.startsWith(label + '：')) {
					return text.replace(label + '：', '').trim();
				}
			}
			return '';
		};

		const lawName = (await page.locator('h1').first().textContent()) || '';
		const lawNumber = await getText('法律番号');
		const billName = await getText('法律案名');
		const submissionSession = await getText('提出回次');
		const remarks = await getText('備考');

		const deliberations: DeliberationRecord[] = [];
		const deliberationSection = page
			.locator('section')
			.filter({ has: page.locator('a[name="deliberation"]') });

		const sectionCount = await deliberationSection.count();
		if (sectionCount > 0) {
			const items = await deliberationSection.locator('li').all();

			for (const item of items) {
				const titleLink = item.locator('h3 a').first();
				const titleText = (await titleLink.textContent()) || '';
				const kokkaiUrl = (await titleLink.getAttribute('href')) || '';

				const pdfLink = item.locator('a[href*="PDF"]').first();
				const pdfUrl = (await pdfLink.getAttribute('href').catch(() => '')) || '';

				const activitySpans = await item.locator('p span').all();
				let activity = '';
				let pageRange = '';

				if (activitySpans.length >= 1) {
					activity = (await activitySpans[0].textContent())?.trim() || '';
				}
				if (activitySpans.length >= 2) {
					pageRange = (await activitySpans[1].textContent())?.trim() || '';
				}

				const match = titleText.match(/第(\d+)回国会\s+(.+?)\s+(.+?)\s+第(\d+)号\s+(.+)/);

				deliberations.push({
					sessionNumber: match ? `第${match[1]}回国会` : '',
					chamber: match ? match[2].trim() : '',
					committee: match ? match[3].trim() : '',
					meetingNumber: match ? `第${match[4]}号` : '',
					date: match ? match[5].trim() : '',
					activity,
					pageRange,
					kokkaiUrl,
					pdfUrl
				});
			}
		}

		return {
			lawId: type === 'lawId' ? id : undefined,
			billId: type === 'billId' ? id : undefined,
			lawNumber: lawNumber || remarks,
			lawName: lawName.trim(),
			billName: billName || lawName.trim(),
			submissionSession,
			deliberations
		};
	} catch (error) {
		console.error('Error fetching hourei bill details:', error);
		return null;
	}
}

// Find a bill on hourei.ndl.go.jp by name and session
async function findHoureiBill(
	page: Page,
	billTitle: string,
	session: number
): Promise<HoureiBillInfo | null> {
	const sessionStr = `第${session}回国会`;
	log(`  Searching hourei for: "${billTitle}" in ${sessionStr}`);

	const searchResults = await searchHoureiBills(page, billTitle, session);
	log(`  Found ${searchResults.length} search results`);

	for (const result of searchResults) {
		if (result.session === sessionStr) {
			log(`  Match found from search: ${result.name}`);
			if (result.lawId) {
				return await fetchHoureiBillDetails(page, result.lawId, 'lawId');
			} else if (result.billId) {
				return await fetchHoureiBillDetails(page, result.billId, 'billId');
			}
		}

		const url = result.lawId
			? `${HOUREI_BASE}/simple/detail?lawId=${result.lawId}`
			: `${HOUREI_BASE}/simple/detail?billId=${result.billId}&searchDiv=2`;

		await page.goto(url, { waitUntil: 'networkidle' });

		const spans = await page.locator('span').all();
		for (const span of spans) {
			const text = await span.textContent();
			if (text && text.startsWith('提出回次：')) {
				const submissionSession = text.replace('提出回次：', '').trim();
				if (submissionSession === sessionStr) {
					log(`  Match found from detail: ${result.name}`);
					if (result.lawId) {
						return await fetchHoureiBillDetails(page, result.lawId, 'lawId');
					} else if (result.billId) {
						return await fetchHoureiBillDetails(page, result.billId, 'billId');
					}
				}
				break;
			}
		}
	}

	log(`  No match found for "${billTitle}" in ${sessionStr}`);
	return null;
}

// Extract meeting parameters from kokkai URL
function parseKokkaiUrl(url: string): { issueId: string; speechIndex?: number } | null {
	const txtMatch = url.match(/\/txt\/(\d+X\d+)/);
	if (txtMatch) {
		const parts = url.split('/');
		const speechIndex = parts[parts.length - 1];
		return {
			issueId: txtMatch[1],
			speechIndex: speechIndex && /^\d+$/.test(speechIndex) ? parseInt(speechIndex) : undefined
		};
	}

	const minIdMatch = url.match(/minId=(\d+X\d+)/);
	if (minIdMatch) {
		const spkNumMatch = url.match(/spkNum=(\d+)/);
		return {
			issueId: minIdMatch[1],
			speechIndex: spkNumMatch ? parseInt(spkNumMatch[1]) : undefined
		};
	}

	return null;
}

// Fetch speeches for a specific meeting from Kokkai API (with retry)
async function fetchMeetingSpeeches(issueId: string, maxRetries = 3): Promise<KokkaiSpeech[]> {
	const url = `${KOKKAI_API_BASE}/speech?issueID=${issueId}&recordPacking=json`;
	log(`    Fetching speeches for issue: ${issueId}`);

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));

			const response = await fetch(url);
			if (!response.ok) {
				console.error(`API error: ${response.status}`);
				if (attempt < maxRetries - 1) {
					await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
					continue;
				}
				return [];
			}

			const data = await response.json();

			if (!data.speechRecord) {
				return [];
			}

			return data.speechRecord.map((record: Record<string, unknown>) => ({
				speechID: record.speechID,
				issueID: record.issueID,
				session: parseInt(String(record.session)),
				nameOfHouse: record.nameOfHouse,
				nameOfMeeting: record.nameOfMeeting,
				issue: record.issue,
				date: record.date,
				speaker: record.speaker,
				speakerGroup: record.speakerGroup || '',
				speakerPosition: record.speakerPosition || '',
				speakerRole: record.speakerRole || '',
				speechOrder: parseInt(String(record.speechOrder)),
				speech: record.speech,
				speechURL: record.speechURL
			}));
		} catch (error) {
			console.error(`Error fetching speeches for ${issueId}:`, error);
			if (attempt < maxRetries - 1) {
				await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
			}
		}
	}

	return [];
}

// Get bills that need debate scraping
async function getBillsToProcess(db: DrizzleDB, skipExisting: boolean, billId: number | null) {
	const query = db
		.select({
			id: schema.bill.id,
			type: schema.bill.type,
			session: schema.bill.submissionSession,
			number: schema.bill.number,
			title: schema.bill.title
		})
		.from(schema.bill);

	if (billId) {
		return query.where(eq(schema.bill.id, billId));
	}

	if (skipExisting) {
		return query.where(sql`${schema.bill.id} NOT IN (SELECT bill_id FROM bill_debates)`);
	}

	return query;
}

// BATCH: Save multiple speeches to the database
async function saveSpeeches(
	db: DrizzleDB,
	billId: number,
	speeches: KokkaiSpeech[],
	dryRun: boolean
): Promise<number> {
	if (speeches.length === 0) return 0;

	// BATCH: Get all existing speech IDs in one query
	const speechIds = speeches.map((s) => s.speechID);
	const existing = await db
		.select({ speechId: schema.billDebates.speechId })
		.from(schema.billDebates)
		.where(inArray(schema.billDebates.speechId, speechIds));

	const existingSet = new Set(existing.map((e) => e.speechId));

	// Filter to only new speeches
	const newSpeeches = speeches.filter((s) => !existingSet.has(s.speechID));

	if (newSpeeches.length === 0) {
		log(`    All ${speeches.length} speeches already exist`);
		return 0;
	}

	if (dryRun) {
		log(`    [DRY-RUN] Would save ${newSpeeches.length} speeches`);
		return newSpeeches.length;
	}

	// BATCH: Insert all new speeches at once
	try {
		await db.insert(schema.billDebates).values(
			newSpeeches.map((speech) => ({
				billId,
				meetingId: speech.issueID,
				speechId: speech.speechID,
				session: speech.session,
				house: speech.nameOfHouse,
				meetingName: speech.nameOfMeeting,
				issueNumber: speech.issue,
				meetingDate: speech.date,
				speakerName: speech.speaker,
				speakerGroup: speech.speakerGroup || null,
				speakerPosition: speech.speakerPosition || null,
				speakerRole: speech.speakerRole || null,
				speechOrder: speech.speechOrder,
				speechContent: speech.speech,
				speechUrl: speech.speechURL || null
			}))
		);
		log(`    Saved ${newSpeeches.length} new speeches (${existingSet.size} already existed)`);
		return newSpeeches.length;
	} catch (error) {
		console.error(`Error saving speeches for bill ${billId}:`, error);
		return 0;
	}
}

// Process a single bill
async function processBill(
	page: Page,
	db: DrizzleDB | null,
	bill: { id: number; type: string; session: number; number: number; title: string | null },
	dryRun: boolean
): Promise<{ meetingsFound: number; speechesSaved: number }> {
	const result = { meetingsFound: 0, speechesSaved: 0 };

	if (!bill.title) {
		console.log(`  Skipping bill ${bill.id}: no title`);
		return result;
	}

	console.log(`\nProcessing bill ${bill.id}: ${bill.title}`);
	console.log(`  Session: 第${bill.session}回国会, Type: ${bill.type}, Number: ${bill.number}`);

	const houreiBill = await findHoureiBill(page, bill.title, bill.session);

	if (!houreiBill) {
		console.log(`  Bill not found on hourei.ndl.go.jp`);
		return result;
	}

	console.log(`  Found on hourei: ${houreiBill.billName}`);
	console.log(`  Deliberation records: ${houreiBill.deliberations.length} meetings`);

	result.meetingsFound = houreiBill.deliberations.length;

	if (dryRun || !db) {
		console.log(`  [DRY-RUN] Would process ${result.meetingsFound} deliberations`);
		return result;
	}

	const processedIssues = new Set<string>();

	for (const deliberation of houreiBill.deliberations) {
		if (!deliberation.kokkaiUrl) {
			log(`    Skipping deliberation with no kokkai URL: ${deliberation.committee}`);
			continue;
		}

		const parsed = parseKokkaiUrl(deliberation.kokkaiUrl);
		if (!parsed) {
			log(`    Could not parse kokkai URL: ${deliberation.kokkaiUrl}`);
			continue;
		}

		if (processedIssues.has(parsed.issueId)) {
			log(`    Already processed issue: ${parsed.issueId}`);
			continue;
		}
		processedIssues.add(parsed.issueId);

		console.log(
			`  Fetching: ${deliberation.chamber} ${deliberation.committee} ${deliberation.date}`
		);

		const speeches = await fetchMeetingSpeeches(parsed.issueId);
		log(`    Found ${speeches.length} speeches`);

		// BATCH: Save all speeches at once
		const savedCount = await saveSpeeches(db, bill.id, speeches, dryRun);
		result.speechesSaved += savedCount;

		await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
	}

	console.log(`  Saved ${result.speechesSaved} speeches from ${processedIssues.size} meetings`);
	return result;
}

async function main() {
	console.log('=== Scrape Debates using hourei.ndl.go.jp ===');
	console.log('Options:', options);

	const DATABASE_URL = process.env.DATABASE_URL;

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

	// Progress tracking for resumable runs
	const progress = new ProgressTracker<DebateProgress>('.scrape-debates-progress.json', {
		processedBillIds: [],
		lastBillId: 0
	});

	if (options.resume) {
		console.log(
			`Resuming from checkpoint: ${progress.getProcessedCount()} bills already processed`
		);
	}

	// Get bills to process
	let bills: Array<{
		id: number;
		type: string;
		session: number;
		number: number;
		title: string | null;
	}> = [];

	if (db) {
		bills = await getBillsToProcess(db, options.skipExisting, options.billId);
	} else {
		console.log('[DRY-RUN] Skipping database query');
		bills = [];
	}

	// Filter out already processed bills if resuming
	if (options.resume) {
		bills = bills.filter((b) => !progress.isProcessed(b.id));
	}

	const billsToProcess = bills.slice(0, options.limit);

	console.log(`\nFound ${bills.length} bills to process`);
	if (options.limit < Infinity) {
		console.log(`Processing first ${billsToProcess.length} bills (--limit=${options.limit})`);
	}

	// Launch browser
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext();
	const page = await context.newPage();

	let totalMeetings = 0;
	let totalSpeeches = 0;

	try {
		for (const bill of billsToProcess) {
			const result = await processBill(page, db, bill, options.dryRun);
			totalMeetings += result.meetingsFound;
			totalSpeeches += result.speechesSaved;

			// Save progress after each bill
			progress.markProcessed(bill.id);
			progress.updateMetadata({ lastBillId: bill.id });
			progress.save();

			await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY * 2));
		}

		// Clear progress on successful completion
		progress.clear();
	} finally {
		await browser.close();
		if (client) await client.end();
	}

	console.log('\n=== Summary ===');
	console.log(`Processed: ${billsToProcess.length} bills`);
	console.log(`Meetings found: ${totalMeetings}`);
	console.log(`Speeches saved: ${totalSpeeches}`);
}

main().catch(console.error);
