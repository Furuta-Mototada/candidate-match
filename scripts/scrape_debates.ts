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
 */

import dotenv from 'dotenv';
dotenv.config();

import { chromium, type Page } from 'playwright';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';

// Configuration
const DATABASE_URL = process.env.DATABASE_URL || '';
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

// Database
const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

// CLI Options
const args = process.argv.slice(2);

function getArgValue(name: string): string | undefined {
	// Handle both --name=value and --name value formats
	const eqIndex = args.findIndex((a) => a.startsWith(`--${name}=`));
	if (eqIndex !== -1) {
		return args[eqIndex].split('=')[1];
	}
	const spaceIndex = args.findIndex((a) => a === `--${name}`);
	if (spaceIndex !== -1 && args[spaceIndex + 1] && !args[spaceIndex + 1].startsWith('-')) {
		return args[spaceIndex + 1];
	}
	return undefined;
}

const options = {
	limit: parseInt(getArgValue('limit') || '0') || Infinity,
	skipExisting: args.includes('--skip-existing'),
	verbose: args.includes('--verbose'),
	billId: parseInt(getArgValue('bill-id') || '0') || null
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

		// Include session number in search to narrow down results
		const searchQuery = sessionNumber ? `${keyword} 第${sessionNumber}回` : keyword;
		await page.fill('input#fw', searchQuery);
		await page.click('button[name="searchFreeword"]');
		await page.waitForLoadState('networkidle');

		// Collect results from all pages
		const allResults: Array<{ lawId?: string; billId?: string; name: string; session?: string }> =
			[];
		let hasNextPage = true;
		let pageNum = 1;
		const maxPages = 10; // Safety limit

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

			// Check for next page button and click it
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

		// Extract basic info
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

		// Extract deliberation records
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

				// Parse title like "第193回国会 衆議院 本会議 第20号 平成29年4月18日"
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

	// Search with session number to narrow down results
	const searchResults = await searchHoureiBills(page, billTitle, session);
	log(`  Found ${searchResults.length} search results`);

	for (const result of searchResults) {
		// Quick check from search results
		if (result.session === sessionStr) {
			log(`  Match found from search: ${result.name}`);
			if (result.lawId) {
				return await fetchHoureiBillDetails(page, result.lawId, 'lawId');
			} else if (result.billId) {
				return await fetchHoureiBillDetails(page, result.billId, 'billId');
			}
		}

		// Check detail page for submission session
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
// Handles both formats:
// 1. /txt/119304889X02020170418/1 (old format)
// 2. /simple/detail?minId=119804601X00120190205&spkNum=1 (from hourei.ndl.go.jp)
function parseKokkaiUrl(url: string): { issueId: string; speechIndex?: number } | null {
	// Try the /txt/ format first
	const txtMatch = url.match(/\/txt\/(\d+X\d+)/);
	if (txtMatch) {
		const parts = url.split('/');
		const speechIndex = parts[parts.length - 1];
		return {
			issueId: txtMatch[1],
			speechIndex: speechIndex && /^\d+$/.test(speechIndex) ? parseInt(speechIndex) : undefined
		};
	}

	// Try the minId format (from hourei.ndl.go.jp)
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

// Fetch speeches for a specific meeting from Kokkai API
async function fetchMeetingSpeeches(issueId: string): Promise<KokkaiSpeech[]> {
	const url = `${KOKKAI_API_BASE}/speech?issueID=${issueId}&recordPacking=json`;
	log(`    Fetching speeches for issue: ${issueId}`);

	try {
		const response = await fetch(url);
		if (!response.ok) {
			console.error(`API error: ${response.status}`);
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
		return [];
	}
}

// Get bills that need debate scraping
async function getBillsToProcess() {
	const query = db
		.select({
			id: schema.bill.id,
			type: schema.bill.type,
			session: schema.bill.submissionSession,
			number: schema.bill.number,
			title: schema.billDetail.title
		})
		.from(schema.bill)
		.innerJoin(schema.billDetail, eq(schema.bill.id, schema.billDetail.billId));

	if (options.billId) {
		return query.where(eq(schema.bill.id, options.billId));
	}

	if (options.skipExisting) {
		return query.where(sql`${schema.bill.id} NOT IN (SELECT bill_id FROM bill_debates)`);
	}

	return query;
}

// Check if a speech already exists in the database
async function speechExists(speechId: string): Promise<boolean> {
	const existing = await db
		.select({ id: schema.billDebates.id })
		.from(schema.billDebates)
		.where(eq(schema.billDebates.speechId, speechId))
		.limit(1);

	return existing.length > 0;
}

// Save a speech to the database
async function saveSpeech(billId: number, speech: KokkaiSpeech): Promise<boolean> {
	try {
		if (await speechExists(speech.speechID)) {
			log(`    Skipping existing speech: ${speech.speechID}`);
			return false;
		}

		await db.insert(schema.billDebates).values({
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
		});

		return true;
	} catch (error) {
		console.error(`Error saving speech ${speech.speechID}:`, error);
		return false;
	}
}

// Process a single bill
async function processBill(
	page: Page,
	bill: { id: number; type: string; session: number; number: number; title: string | null }
): Promise<{ meetingsFound: number; speechesSaved: number }> {
	const result = { meetingsFound: 0, speechesSaved: 0 };

	if (!bill.title) {
		console.log(`  Skipping bill ${bill.id}: no title`);
		return result;
	}

	console.log(`\nProcessing bill ${bill.id}: ${bill.title}`);
	console.log(`  Session: 第${bill.session}回国会, Type: ${bill.type}, Number: ${bill.number}`);

	// Find bill on hourei.ndl.go.jp
	const houreiBill = await findHoureiBill(page, bill.title, bill.session);

	if (!houreiBill) {
		console.log(`  Bill not found on hourei.ndl.go.jp`);
		return result;
	}

	console.log(`  Found on hourei: ${houreiBill.billName}`);
	console.log(`  Deliberation records: ${houreiBill.deliberations.length} meetings`);

	result.meetingsFound = houreiBill.deliberations.length;

	// Process each deliberation record
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

		// Avoid fetching the same meeting multiple times
		if (processedIssues.has(parsed.issueId)) {
			log(`    Already processed issue: ${parsed.issueId}`);
			continue;
		}
		processedIssues.add(parsed.issueId);

		console.log(
			`  Fetching: ${deliberation.chamber} ${deliberation.committee} ${deliberation.date}`
		);

		// Fetch all speeches from this meeting
		const speeches = await fetchMeetingSpeeches(parsed.issueId);
		log(`    Found ${speeches.length} speeches`);

		// Save speeches to database
		for (const speech of speeches) {
			const saved = await saveSpeech(bill.id, speech);
			if (saved) {
				result.speechesSaved++;
			}
		}

		// Rate limiting
		await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
	}

	console.log(`  Saved ${result.speechesSaved} speeches from ${processedIssues.size} meetings`);
	return result;
}

async function main() {
	console.log('=== Scrape Debates using hourei.ndl.go.jp ===');
	console.log('Options:', options);

	// Get bills to process
	const bills = await getBillsToProcess();
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
			const result = await processBill(page, bill);
			totalMeetings += result.meetingsFound;
			totalSpeeches += result.speechesSaved;

			// Rate limiting between bills
			await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY * 2));
		}
	} finally {
		await browser.close();
		await client.end();
	}

	console.log('\n=== Summary ===');
	console.log(`Processed: ${billsToProcess.length} bills`);
	console.log(`Meetings found: ${totalMeetings}`);
	console.log(`Speeches saved: ${totalSpeeches}`);
}

main().catch(console.error);
