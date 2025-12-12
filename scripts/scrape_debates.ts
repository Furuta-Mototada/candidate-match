#!/usr/bin/env tsx
/**
 * Scrape debate records using hourei.ndl.go.jp
 *
 * This script:
 * 1. Searches for each bill on hourei.ndl.go.jp by 提出回次/種別/提出番号
 * 2. Extracts the deliberation history which contains exact meeting links
 * 3. Fetches meeting info from kokkai.ndl.go.jp to identify relevant speech sections
 * 4. Fetches speech content with proper pagination
 * 5. Stores debates in the bill_debates table
 *
 * Key improvements:
 * - Precise bill matching: Uses session, type (衆法/参法/閣法), and number
 * - Full pagination: Fetches all speeches, not just first 30
 * - Relevant sections: Extracts only speeches related to the target bill
 * - Efficiency: Uses shared rate limiter, batch operations, caching
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
	DrizzleDB,
	fetchWithRetry,
	BillType
} from './lib';

// Configuration
const KOKKAI_API_BASE = 'https://kokkai.ndl.go.jp/api';
const HOUREI_BASE = 'https://hourei.ndl.go.jp';
const RATE_LIMIT_MS = 2000; // 2 seconds between API calls (conservative but faster)
const MAX_RECORDS_PER_REQUEST = 100; // Maximum for speech API
const DEFAULT_CONCURRENCY = 3; // Number of parallel browser pages for hourei

// Global cache for meeting speeches (avoid re-fetching same meeting for different bills)
const meetingSpeechCache = new Map<string, KokkaiSpeech[]>();

/**
 * Run tasks in parallel with staggered starts to avoid overwhelming servers
 */
async function runStaggered<T>(tasks: (() => Promise<T>)[], staggerDelayMs: number): Promise<T[]> {
	const promises = tasks.map(
		(task, idx) =>
			new Promise<T>((resolve) => {
				setTimeout(async () => {
					const result = await task();
					resolve(result);
				}, idx * staggerDelayMs);
			})
	);
	return Promise.all(promises);
}

// Map bill types to hourei search format
const BILL_TYPE_MAP: Record<BillType, string> = {
	衆法: '衆法',
	参法: '参法',
	閣法: '閣法'
};

// Types
interface DeliberationRecord {
	sessionNumber: number;
	chamber: string;
	committee: string;
	meetingNumber: string;
	date: string;
	activity: string;
	pageRange: string;
	kokkaiUrl: string;
	pdfUrl: string;
	issueId?: string;
}

interface HoureiBillInfo {
	lawId?: string;
	billId?: string;
	lawNumber: string;
	lawName: string;
	billName: string;
	billType: string; // 衆法/参法/閣法
	billNumber: number;
	submissionSession: number;
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

interface KokkaiMeetingInfo {
	issueID: string;
	session: number;
	nameOfHouse: string;
	nameOfMeeting: string;
	issue: string;
	date: string;
	// Topics discussed in this meeting (from 議事冒頭)
	topicSpeeches?: Array<{
		speechOrder: number;
		speech: string;
	}>;
}

interface KokkaiApiResponse<T> {
	numberOfRecords: number;
	numberOfReturn: number;
	startRecord: number;
	nextRecordPosition?: number;
	speechRecord?: T[];
	meetingRecord?: T[];
	message?: string;
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
	resume: hasFlag(args, 'resume'),
	concurrency: parseInt(getValue(args, 'concurrency') || '0') || DEFAULT_CONCURRENCY
};

function log(...messages: unknown[]) {
	if (options.verbose) {
		console.log(...messages);
	}
}

/**
 * Search hourei.ndl.go.jp for a bill by exact 提出番号 (session/type/number)
 * This is more accurate than title-based search
 *
 * NOTE: Currently disabled - the form fields don't exist on the simple search page.
 * Kept for reference in case the hourei.ndl.go.jp interface changes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function searchHoureiBillByNumber(
	page: Page,
	session: number,
	billType: BillType,
	billNumber: number
): Promise<{ lawId?: string; billId?: string } | null> {
	try {
		// Navigate to detailed bill search form
		await page.goto(`${HOUREI_BASE}/simple/`, { waitUntil: 'networkidle' });

		// Scroll to and click the 詳細検索 section for bills (法律案・条約承認案件検索)
		// Fill in the 提出番号 fields: 国会回次, 種別, 号
		const sessionInput = page.locator('input[name="submitNoKaijiN"]');
		const typeSelect = page.locator('select[name="submitNoType"]');
		const numberInput = page.locator('input[name="submitNoNo"]');

		// Check if the detailed search form exists
		if (
			(await sessionInput.count()) === 0 ||
			(await typeSelect.count()) === 0 ||
			(await numberInput.count()) === 0
		) {
			log('    Detailed search form not found, falling back to freeword search');
			return null;
		}

		await sessionInput.fill(session.toString());
		await typeSelect.selectOption(BILL_TYPE_MAP[billType]);
		await numberInput.fill(billNumber.toString());

		// Click the search button within the 法律案・条約承認案件検索 section
		const searchButton = page
			.locator('form')
			.filter({ has: page.locator('input[name="submitNoKaijiN"]') })
			.locator('button[type="submit"], input[type="submit"]')
			.first();

		await searchButton.click();
		await page.waitForLoadState('networkidle');

		// Get the first result
		const result = await page.evaluate(() => {
			const link = document.querySelector('section li h3 a');
			if (!link) return null;

			const href = link.getAttribute('href') || '';
			const lawIdMatch = href.match(/lawId=(\d+)/);
			const billIdMatch = href.match(/billId=(\d+)/);

			if (lawIdMatch || billIdMatch) {
				return {
					lawId: lawIdMatch ? lawIdMatch[1] : undefined,
					billId: billIdMatch ? billIdMatch[1] : undefined
				};
			}
			return null;
		});

		if (result) {
			log(`    Found bill via exact search: lawId=${result.lawId}, billId=${result.billId}`);
		}
		return result;
	} catch (error) {
		console.error('Error searching hourei by number:', error);
		return null;
	}
}

/**
 * Fallback: Search hourei.ndl.go.jp for a bill by title (less accurate)
 *
 * NOTE: Currently unused - findHoureiBill uses a simpler direct approach.
 * Kept for reference.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function searchHoureiBillByTitle(
	page: Page,
	title: string,
	session: number,
	billType: BillType,
	billNumber: number
): Promise<{ lawId?: string; billId?: string } | null> {
	try {
		await page.goto(`${HOUREI_BASE}/simple/`, { waitUntil: 'networkidle' });

		// Search by title with session number
		const searchQuery = `${title} 第${session}回`;
		await page.fill('input#fw', searchQuery);
		await page.click('button[name="searchFreeword"]');
		await page.waitForLoadState('networkidle');

		// Look through results to find matching bill
		const results = await page.evaluate(() => {
			const items: Array<{
				lawId?: string;
				billId?: string;
				name: string;
				description: string;
			}> = [];
			const listItems = document.querySelectorAll('section li');

			for (const li of listItems) {
				const link = li.querySelector('h3 a');
				if (!link) continue;

				const href = link.getAttribute('href') || '';
				const lawIdMatch = href.match(/lawId=(\d+)/);
				const billIdMatch = href.match(/billId=(\d+)/);

				if (lawIdMatch || billIdMatch) {
					items.push({
						lawId: lawIdMatch ? lawIdMatch[1] : undefined,
						billId: billIdMatch ? billIdMatch[1] : undefined,
						name: link.textContent?.trim() || '',
						description: (li.querySelector('p')?.textContent || '').trim()
					});
				}
			}
			return items;
		});

		// Find the result that matches our session and bill type/number
		const sessionPattern = `第${session}回国会`;
		const billTypePattern = BILL_TYPE_MAP[billType];
		const billNumberPattern = `第${billNumber}号`;

		for (const result of results) {
			// Check if description contains matching session and bill info
			if (result.description.includes(sessionPattern)) {
				// Also verify bill type and number if available in description
				if (
					result.description.includes(billTypePattern) &&
					result.description.includes(billNumberPattern)
				) {
					log(`    Found exact match via title search: ${result.name}`);
					return { lawId: result.lawId, billId: result.billId };
				}
			}
		}

		// If no exact match, try fetching details for each result to verify
		for (const result of results.slice(0, 5)) {
			// Check first 5 results
			const details = await fetchHoureiBillDetails(
				page,
				result.lawId || result.billId!,
				result.lawId ? 'lawId' : 'billId'
			);
			if (
				details &&
				details.submissionSession === session &&
				details.billType === billType &&
				details.billNumber === billNumber
			) {
				log(`    Found match after detail check: ${result.name}`);
				return { lawId: result.lawId, billId: result.billId };
			}
		}

		return null;
	} catch (error) {
		console.error('Error searching hourei by title:', error);
		return null;
	}
}

/**
 * Fetch bill details and deliberation history from hourei.ndl.go.jp
 * Now extracts bill type and number for verification
 */
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
		const submissionSessionStr = await getText('提出回次');
		const billTypeStr = await getText('種別'); // 衆法/参法/閣法
		const submissionNumberStr = await getText('提出番号'); // Just the number, e.g., "1"
		const remarks = await getText('備考');

		// Parse submission session: "第XXX回国会" -> XXX
		const sessionMatch = submissionSessionStr.match(/第(\d+)回/);
		const submissionSession = sessionMatch ? parseInt(sessionMatch[1]) : 0;

		// Parse bill type from 種別 field
		const billType = (
			['衆法', '参法', '閣法'].includes(billTypeStr) ? billTypeStr : '閣法'
		) as BillType;

		// Parse bill number from 提出番号 field (just a number)
		const billNumber = parseInt(submissionNumberStr) || 0;

		log(`    Parsed: session=${submissionSession}, type=${billType}, number=${billNumber}`);

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

				// Parse: 第XXX回国会 院名 委員会名 第YY号 日付
				const match = titleText.match(/第(\d+)回国会\s+(.+?)\s+(.+?)\s+第(\d+)号\s+(.+)/);
				const parsed = parseKokkaiUrl(kokkaiUrl);

				deliberations.push({
					sessionNumber: match ? parseInt(match[1]) : 0,
					chamber: match ? match[2].trim() : '',
					committee: match ? match[3].trim() : '',
					meetingNumber: match ? `第${match[4]}号` : '',
					date: match ? match[5].trim() : '',
					activity,
					pageRange,
					kokkaiUrl,
					pdfUrl,
					issueId: parsed?.issueId
				});
			}
		}

		return {
			lawId: type === 'lawId' ? id : undefined,
			billId: type === 'billId' ? id : undefined,
			lawNumber: lawNumber || remarks,
			lawName: lawName.trim(),
			billName: billName || lawName.trim(),
			billType,
			billNumber,
			submissionSession,
			deliberations
		};
	} catch (error) {
		console.error('Error fetching hourei bill details:', error);
		return null;
	}
}

/**
 * Find a bill on hourei.ndl.go.jp matching session, type, and number
 * Simplified: Search by title + session, then verify each result's session/type/number
 */
async function findHoureiBill(
	page: Page,
	bill: { session: number; type: BillType; number: number; title: string | null }
): Promise<HoureiBillInfo | null> {
	log(`  Searching hourei for: ${bill.type} ${bill.session}回 第${bill.number}号`);

	if (!bill.title) {
		log(`  No title provided, cannot search`);
		return null;
	}

	try {
		// Search by title with session number to narrow down results
		await page.goto(`${HOUREI_BASE}/simple/`, { waitUntil: 'networkidle' });

		// Include session number in search to narrow down for common bill names
		const searchQuery = `${bill.title} 第${bill.session}回`;
		await page.fill('input#fw', searchQuery);
		await page.click('button[name="searchFreeword"]');
		await page.waitForLoadState('networkidle');

		// Get all results from all pages (up to 3 pages)
		const allResults: Array<{
			lawId?: string;
			billId?: string;
			name: string;
		}> = [];

		for (let pageNum = 1; pageNum <= 3; pageNum++) {
			const pageResults = await page.evaluate(() => {
				const items: Array<{
					lawId?: string;
					billId?: string;
					name: string;
				}> = [];
				const links = document.querySelectorAll('section li h3 a');

				for (const link of links) {
					const href = link.getAttribute('href') || '';
					const lawIdMatch = href.match(/lawId=(\d+)/);
					const billIdMatch = href.match(/billId=(\d+)/);

					if (lawIdMatch || billIdMatch) {
						items.push({
							lawId: lawIdMatch ? lawIdMatch[1] : undefined,
							billId: billIdMatch ? billIdMatch[1] : undefined,
							name: link.textContent?.trim() || ''
						});
					}
				}
				return items;
			});

			allResults.push(...pageResults);

			// Try to go to next page
			const nextButton = page.locator('a.page-link:has-text("次へ")').first();
			const hasNextPage = await nextButton.isVisible().catch(() => false);
			if (hasNextPage && pageNum < 3) {
				await nextButton.click();
				await page.waitForLoadState('networkidle');
			} else {
				break;
			}
		}

		log(`    Found ${allResults.length} search results`);

		// Check each result's details to find exact match
		for (const result of allResults) {
			const details = await fetchHoureiBillDetails(
				page,
				result.lawId || result.billId!,
				result.lawId ? 'lawId' : 'billId'
			);

			if (
				details &&
				details.submissionSession === bill.session &&
				details.billType === bill.type &&
				details.billNumber === bill.number
			) {
				log(`    Match found: ${details.billName}`);
				return details;
			}
		}

		log(`  No match found for ${bill.type} ${bill.session}回 第${bill.number}号`);
		return null;
	} catch (error) {
		console.error('Error finding hourei bill:', error);
		return null;
	}
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

/**
 * Fetch meeting info including topics discussed (from 議事冒頭)
 * This helps identify which sections of the meeting discuss our target bill
 *
 * NOTE: This function is available for future enhancement to improve
 * topic detection using the meeting API's searchRange=冒頭 feature.
 * Currently, we detect topics from the speech content directly.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchMeetingInfo(issueId: string): Promise<KokkaiMeetingInfo | null> {
	const url = `${KOKKAI_API_BASE}/meeting?issueID=${issueId}&recordPacking=json&maximumRecords=1`;
	log(`    Fetching meeting info for: ${issueId}`);

	try {
		const response = await fetchWithRetry(url, { rateLimitMs: RATE_LIMIT_MS });
		if (response.status !== 200) {
			console.error(`Meeting API error: ${response.status}`);
			return null;
		}

		const data = (await response.json()) as KokkaiApiResponse<Record<string, unknown>>;
		if (!data.meetingRecord || data.meetingRecord.length === 0) {
			return null;
		}

		const meeting = data.meetingRecord[0];
		const speechRecords = (meeting.speechRecord as Record<string, unknown>[]) || [];

		// First few speeches usually contain the agenda/topics
		const topicSpeeches = speechRecords.slice(0, 3).map((s) => ({
			speechOrder: parseInt(String(s.speechOrder)),
			speech: String(s.speech || '')
		}));

		return {
			issueID: String(meeting.issueID),
			session: parseInt(String(meeting.session)),
			nameOfHouse: String(meeting.nameOfHouse),
			nameOfMeeting: String(meeting.nameOfMeeting),
			issue: String(meeting.issue),
			date: String(meeting.date),
			topicSpeeches
		};
	} catch (error) {
		console.error(`Error fetching meeting info for ${issueId}:`, error);
		return null;
	}
}

/**
 * Fetch ALL speeches for a specific meeting from Kokkai API with proper pagination
 * Now uses fetchWithRetry and fetches all pages, with caching
 */
async function fetchAllMeetingSpeeches(issueId: string): Promise<KokkaiSpeech[]> {
	// Check cache first
	if (meetingSpeechCache.has(issueId)) {
		log(`    Using cached speeches for issue: ${issueId}`);
		return meetingSpeechCache.get(issueId)!;
	}

	const allSpeeches: KokkaiSpeech[] = [];
	let startRecord = 1;
	let hasMore = true;

	log(`    Fetching all speeches for issue: ${issueId}`);

	while (hasMore) {
		const url = `${KOKKAI_API_BASE}/speech?issueID=${issueId}&recordPacking=json&maximumRecords=${MAX_RECORDS_PER_REQUEST}&startRecord=${startRecord}`;

		try {
			const response = await fetchWithRetry(url, { rateLimitMs: RATE_LIMIT_MS });
			if (response.status !== 200) {
				console.error(`Speech API error: ${response.status}`);
				break;
			}

			const data = (await response.json()) as KokkaiApiResponse<Record<string, unknown>>;

			if (data.message) {
				log(`    API message: ${data.message}`);
				break;
			}

			if (!data.speechRecord || data.speechRecord.length === 0) {
				break;
			}

			const speeches = data.speechRecord.map((record) => ({
				speechID: String(record.speechID),
				issueID: String(record.issueID),
				session: parseInt(String(record.session)),
				nameOfHouse: String(record.nameOfHouse),
				nameOfMeeting: String(record.nameOfMeeting),
				issue: String(record.issue),
				date: String(record.date),
				speaker: String(record.speaker),
				speakerGroup: String(record.speakerGroup || ''),
				speakerPosition: String(record.speakerPosition || ''),
				speakerRole: String(record.speakerRole || ''),
				speechOrder: parseInt(String(record.speechOrder)),
				speech: String(record.speech),
				speechURL: String(record.speechURL || '')
			}));

			allSpeeches.push(...speeches);
			log(
				`    Fetched ${speeches.length} speeches (total: ${allSpeeches.length}/${data.numberOfRecords})`
			);

			if (data.nextRecordPosition) {
				startRecord = data.nextRecordPosition;
			} else {
				hasMore = false;
			}
		} catch (error) {
			console.error(`Error fetching speeches for ${issueId}:`, error);
			break;
		}
	}

	// Cache the result
	meetingSpeechCache.set(issueId, allSpeeches);
	return allSpeeches;
}

/**
 * Extract speeches relevant to a specific bill from a meeting
 *
 * Strategy:
 * 1. Find mentions of the bill name in speeches (議事冒頭 section)
 * 2. Track topic transitions by looking for "案件番号" or bill name mentions
 * 3. Include speeches from when bill is mentioned until next topic
 *
 * This is complex because meetings often discuss multiple bills
 */
function extractRelevantSpeeches(
	speeches: KokkaiSpeech[],
	billName: string,
	billType: BillType,
	billNumber: number
): KokkaiSpeech[] {
	if (speeches.length === 0) return [];

	// Sort by speech order
	const sortedSpeeches = [...speeches].sort((a, b) => a.speechOrder - b.speechOrder);

	// Build search patterns for the bill
	const patterns = [billName, `${BILL_TYPE_MAP[billType]}第${billNumber}号`, `第${billNumber}号`];

	// Find speech ranges where our bill is being discussed
	const relevantRanges: Array<{ start: number; end: number }> = [];
	let currentRange: { start: number; end: number } | null = null;
	let billMentioned = false;

	// Common patterns that indicate topic transition
	const topicTransitionPatterns = [
		/次に、/,
		/次の案件/,
		/議案第\d+号/,
		/第\d+号に移ります/,
		/これより.*議題といたします/,
		/休憩/,
		/散会/
	];

	for (let i = 0; i < sortedSpeeches.length; i++) {
		const speech = sortedSpeeches[i];
		const content = speech.speech;

		// Check if this speech mentions our bill
		const mentionsBill = patterns.some((p) => content.includes(p));

		// Check if this is a topic transition
		const isTransition = topicTransitionPatterns.some((p) => p.test(content));

		if (mentionsBill && !billMentioned) {
			// Start of relevant section
			billMentioned = true;
			currentRange = { start: i, end: i };
		} else if (billMentioned) {
			if (isTransition && !mentionsBill) {
				// End of relevant section (topic changed to something else)
				if (currentRange) {
					currentRange.end = i - 1;
					relevantRanges.push(currentRange);
					currentRange = null;
				}
				billMentioned = false;
			} else {
				// Extend current range
				if (currentRange) {
					currentRange.end = i;
				}
			}
		}
	}

	// Close any open range
	if (currentRange) {
		currentRange.end = sortedSpeeches.length - 1;
		relevantRanges.push(currentRange);
	}

	// If no specific ranges found but bill was in this meeting (from hourei), include all
	if (relevantRanges.length === 0) {
		// Check if any speech mentions the bill at all
		const anyMention = sortedSpeeches.some((s) => patterns.some((p) => s.speech.includes(p)));
		if (anyMention) {
			log(`    No clear section boundaries found, including all speeches`);
			return sortedSpeeches;
		}
		// If bill not mentioned, still include all (trusting hourei data)
		log(`    Bill not explicitly mentioned, including all speeches from meeting`);
		return sortedSpeeches;
	}

	// Extract speeches from all relevant ranges
	const relevant: KokkaiSpeech[] = [];
	for (const range of relevantRanges) {
		for (let i = range.start; i <= range.end; i++) {
			if (!relevant.includes(sortedSpeeches[i])) {
				relevant.push(sortedSpeeches[i]);
			}
		}
	}

	log(`    Extracted ${relevant.length}/${sortedSpeeches.length} relevant speeches`);
	return relevant;
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

	// BATCH: Insert all new speeches at once, with conflict handling for parallel workers
	try {
		await db
			.insert(schema.billDebates)
			.values(
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
			)
			.onConflictDoNothing({ target: schema.billDebates.speechId });
		log(`    Saved ${newSpeeches.length} new speeches (${existingSet.size} already existed)`);
		return newSpeeches.length;
	} catch (error) {
		console.error(`Error saving speeches for bill ${billId}:`, error);
		return 0;
	}
}

/**
 * Process a single bill - find on hourei, fetch speeches, extract relevant ones
 */
async function processBill(
	page: Page,
	db: DrizzleDB | null,
	bill: { id: number; type: BillType; session: number; number: number; title: string | null },
	dryRun: boolean
): Promise<{ meetingsFound: number; speechesSaved: number }> {
	const result = { meetingsFound: 0, speechesSaved: 0 };
	const prefix = `[Bill ${bill.id}]`;

	console.log(`\n${prefix} ${bill.title || '(no title)'}`);
	console.log(
		`${prefix}   Session: 第${bill.session}回国会, Type: ${bill.type}, Number: ${bill.number}`
	);

	// Find bill on hourei using exact matching - with retry for transient failures
	let houreiBill: HoureiBillInfo | null = null;
	for (let attempt = 1; attempt <= 2; attempt++) {
		houreiBill = await findHoureiBill(page, {
			session: bill.session,
			type: bill.type,
			number: bill.number,
			title: bill.title
		});
		if (houreiBill) break;
		if (attempt < 2) {
			log(`${prefix}   Retry search (attempt ${attempt + 1})...`);
			await new Promise((r) => setTimeout(r, 1000)); // Wait before retry
		}
	}

	if (!houreiBill) {
		console.log(`${prefix}   ⚠ Not found on hourei.ndl.go.jp`);
		return result;
	}

	console.log(`${prefix}   ✓ Found: ${houreiBill.billName}`);
	console.log(`${prefix}   ${houreiBill.deliberations.length} meetings`);

	result.meetingsFound = houreiBill.deliberations.length;

	if (dryRun || !db) {
		console.log(`${prefix}   [DRY-RUN] Would process ${result.meetingsFound} deliberations`);
		return result;
	}

	const processedIssues = new Set<string>();
	const billName = houreiBill.billName || bill.title || '';

	for (const deliberation of houreiBill.deliberations) {
		// Use pre-parsed issueId if available, otherwise parse from URL
		const issueId = deliberation.issueId || parseKokkaiUrl(deliberation.kokkaiUrl)?.issueId;

		if (!issueId) {
			log(`${prefix}   Skipping (no issue ID): ${deliberation.committee}`);
			continue;
		}

		if (processedIssues.has(issueId)) {
			continue; // Silent skip for duplicates
		}
		processedIssues.add(issueId);

		log(
			`${prefix}   Fetching: ${deliberation.chamber} ${deliberation.committee} ${deliberation.date}`
		);

		// Fetch ALL speeches with proper pagination
		const allSpeeches = await fetchAllMeetingSpeeches(issueId);
		log(`${prefix}   → ${allSpeeches.length} speeches in meeting`);

		// Extract only relevant speeches for this bill
		const relevantSpeeches = extractRelevantSpeeches(allSpeeches, billName, bill.type, bill.number);

		// Save to database
		const savedCount = await saveSpeeches(db, bill.id, relevantSpeeches, dryRun);
		result.speechesSaved += savedCount;
	}

	console.log(
		`${prefix}   ✓ Saved ${result.speechesSaved} speeches from ${processedIssues.size} meetings`
	);
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
	const progress = new ProgressTracker<DebateProgress>('.cache/scrape-debates-progress.json', {
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
		type: BillType;
		session: number;
		number: number;
		title: string | null;
	}> = [];

	if (db) {
		const rawBills = await getBillsToProcess(db, options.skipExisting, options.billId);
		// Cast types properly
		bills = rawBills.map((b) => ({
			...b,
			type: b.type as BillType
		}));
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
	console.log(`Concurrency: ${options.concurrency} parallel workers`);

	// Launch browser with SEPARATE CONTEXTS for parallel processing
	// Using separate contexts prevents session/cookie interference between workers
	const browser = await chromium.launch({ headless: true });

	// Create worker contexts and pages for parallel processing
	const workers: Array<{ context: Awaited<ReturnType<typeof browser.newContext>>; page: Page }> =
		[];
	for (let i = 0; i < options.concurrency; i++) {
		const context = await browser.newContext();
		const page = await context.newPage();
		workers.push({ context, page });
	}

	let totalMeetings = 0;
	let totalSpeeches = 0;
	let processedCount = 0;
	let notFoundCount = 0;

	try {
		// Process bills in parallel batches with staggered starts
		for (let i = 0; i < billsToProcess.length; i += options.concurrency) {
			const batch = billsToProcess.slice(i, i + options.concurrency);
			const startTime = Date.now();

			// Stagger starts by 1000ms to avoid overwhelming hourei.ndl.go.jp
			const results = await runStaggered(
				batch.map((bill, idx) => () => processBill(workers[idx].page, db, bill, options.dryRun)),
				1000
			);

			for (let j = 0; j < batch.length; j++) {
				const bill = batch[j];
				const result = results[j];

				totalMeetings += result.meetingsFound;
				totalSpeeches += result.speechesSaved;
				processedCount++;
				if (result.meetingsFound === 0) notFoundCount++;

				// Save progress after each bill
				progress.markProcessed(bill.id);
				progress.updateMetadata({ lastBillId: bill.id });
			}

			progress.save();

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const remaining = billsToProcess.length - processedCount;
			console.log(
				`\n[Progress] ${processedCount}/${billsToProcess.length} bills | ${notFoundCount} not found | ${remaining} remaining | batch: ${elapsed}s`
			);

			// Clear cache periodically to prevent memory bloat (every 50 bills)
			if (processedCount % 50 === 0) {
				meetingSpeechCache.clear();
				log(`Cleared meeting cache to free memory`);
			}
		}

		// Clear progress on successful completion
		progress.clear();
	} finally {
		// Close all contexts
		for (const worker of workers) {
			await worker.context.close();
		}
		await browser.close();
		if (client) await client.end();
	}

	console.log('\n=== Summary ===');
	console.log(`Processed: ${billsToProcess.length} bills`);
	console.log(`Meetings found: ${totalMeetings}`);
	console.log(`Speeches saved: ${totalSpeeches}`);
}

main().catch(console.error);
