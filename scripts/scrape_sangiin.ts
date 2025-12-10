/**
 * Scrape bill information from the House of Councillors (Sangiin) website
 *
 * This script:
 * 1. Fetches bill listings from sangiin.go.jp for each Diet session
 * 2. Extracts bill metadata, deliberation status, and voting records
 * 3. Stores data in the database
 *
 * Usage:
 *   pnpm tsx scripts/scrape_sangiin.ts [startSession] [endSession] [--dry-run]
 */

import { load } from 'cheerio';
import { eq, and, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import {
	fetchWithRetry,
	resolveUrl,
	parseArgs,
	hasFlag,
	getPositionalInt,
	createDbConnection,
	schema,
	parseJapaneseDate,
	batchGetOrCreateMembers,
	getOrCreateCommittee,
	type DrizzleDB,
	type BillType,
	type VotingMethod
} from './lib';

// Configuration
const BASE_URL = 'https://www.sangiin.go.jp';
const DEFAULT_START_SESSION = 198;
const DEFAULT_END_SESSION = 219;

// Types
interface Committee {
	name: string;
	chamber: '衆議院' | '参議院';
}

interface Vote {
	chamber: '衆議院' | '参議院';
	method: string;
	date: string | null;
	voteUrl?: string;
}

interface VoteMember {
	name: string;
	approved: boolean;
}

/**
 * Map voting method variations to standard enum values
 */
const VOTING_METHOD_MAP: Record<string, VotingMethod> = {
	異議なし採決: '異議なし採決',
	異議の有無: '異議なし採決',
	起立投票: '起立投票',
	起立: '起立投票',
	記名投票: '記名投票',
	押しボタン: '押しボタン'
};

/**
 * Process a single bill from a session
 */
async function processBill(
	db: DrizzleDB | null,
	billType: { name: BillType; selector: string },
	billSession: number,
	billNumber: number,
	billTitle: string,
	billDetailUrl: string,
	startSession: number,
	dryRun: boolean
): Promise<void> {
	let submissionDate: string | null = null;
	let billResult: '可決' | '否決' | '撤回' | '未了' | null = null;
	let resultDate: string | null = null;
	const committees: Committee[] = [];
	const votes: Vote[] = [];

	// Fetch bill detail page
	if (billDetailUrl) {
		try {
			const detailRes = await fetchWithRetry(billDetailUrl);
			if (detailRes.status === 200) {
				const detailBody = await detailRes.text();
				const $detail = load(detailBody);

				// Variables to track deliberation status
				let remarks = '';
				let firstOriginatedChamber = '';
				let shuginPlenary = '';
				let sanginPlenary = '';

				// Extract metadata from table rows
				$detail('table tr').each((_, row) => {
					const th = $detail(row).find('th').text().trim();
					const td = $detail(row).find('td').text().trim();

					if (th === '提出日' && td && td !== '　' && td !== '') {
						const parsedDate = parseJapaneseDate(td);
						if (parsedDate) submissionDate = parsedDate;
					}

					if (th === '公布年月日' && td && td !== '　' && td !== '') {
						const pubDate = parseJapaneseDate(td);
						if (pubDate) {
							billResult = '可決';
							resultDate = pubDate;
						}
					}

					if (th === '備考' && td && td !== '　' && td !== '') {
						remarks = td;
						if (remarks.includes('撤回')) {
							billResult = '撤回';
							// Note: resultDate for 撤回 would need to be parsed from remarks if available
						}
					}

					if (th === '先議区分' && td && td !== '　' && td !== '') {
						firstOriginatedChamber = td;
					}
				});

				// Extract committees from both chambers
				const processChamberCommittees = (chamberName: '衆議院' | '参議院') => {
					$detail('table').each((_, table) => {
						const tableHeader = $detail(table).find('th[colspan="2"]').text().trim();
						if (tableHeader.includes(`${chamberName}委員会等経過`)) {
							$detail(table)
								.find('tr')
								.each((__, row) => {
									const th = $detail(row).find('th').text().trim();
									const td = $detail(row).find('td').text().trim();
									if (th === '付託委員会等' && td && td !== '　' && td !== '') {
										committees.push({ name: td, chamber: chamberName });
									}
								});
						}
					});
				};

				processChamberCommittees('衆議院');
				processChamberCommittees('参議院');

				// Extract voting information
				const processChamberVotes = (chamberName: '衆議院' | '参議院') => {
					$detail('table').each((_, table) => {
						const tableHeader = $detail(table).find('th[colspan="2"]').text().trim();
						if (tableHeader.includes(`${chamberName}本会議経過`)) {
							let voteMethod: string | null = null;
							let voteDate: string | null = null;
							let voteUrl: string | null = null;
							let result: string | null = null;

							$detail(table)
								.find('tr')
								.each((__, row) => {
									const th = $detail(row).find('th').text().trim();
									const td = $detail(row).find('td');
									const tdText = td.text().trim();

									if (th === '採決方法' && tdText && tdText !== '　') {
										voteMethod = tdText.split('（')[0].trim();
										const link = td.find('a');
										if (link.length > 0) {
											const href = link.attr('href');
											if (href) voteUrl = resolveUrl(billDetailUrl, href);
										}
									}

									if (th === '議決日' && tdText && tdText !== '　') {
										voteDate = parseJapaneseDate(tdText);
									}

									if (th === '議決' && tdText && tdText !== '　') {
										result = tdText;
									}
								});

							// Track plenary activity and determine bill result
							if (chamberName === '衆議院') {
								shuginPlenary = voteMethod || result || '';
								if (result === '否決') {
									billResult = '否決';
									resultDate = voteDate;
								}
							} else if (chamberName === '参議院') {
								sanginPlenary = voteMethod || result || '';
								if (result === '否決' && firstOriginatedChamber === '本院先議') {
									billResult = '否決';
									resultDate = voteDate;
								}
							}

							if (voteMethod && voteMethod !== '－') {
								votes.push({
									chamber: chamberName,
									method: voteMethod,
									date: voteDate,
									voteUrl: voteUrl || undefined
								});
							}
						}
					});
				};

				processChamberVotes('衆議院');
				processChamberVotes('参議院');

				// Check for 未了 case (only for completed sessions)
				if (billSession < DEFAULT_END_SESSION && !shuginPlenary && !sanginPlenary && !billResult) {
					billResult = '未了';
					// resultDate for 未了 would be the session end date
				}
			}
		} catch (err) {
			console.error(`Error fetching bill detail for ${billDetailUrl}:`, err);
		}
	}

	// Database operations
	if (dryRun || !db) {
		console.log(
			`[DRY-RUN] Would insert/update bill: ${billType.name}-${billSession}-${billNumber}`
		);
		console.log(`  Title: ${billTitle}`);
		console.log(`  Submission Date: ${submissionDate}`);
		console.log(`  Result: ${billResult}`);
		console.log(`  Result Date: ${resultDate}`);
		console.log(`  Committees: ${JSON.stringify(committees)}`);
		console.log(`  Votes: ${votes.length}`);
		return;
	}

	// Check if bill exists
	const existingBills = await db
		.select()
		.from(schema.bill)
		.where(
			and(
				eq(schema.bill.type, billType.name),
				eq(schema.bill.submissionSession, billSession),
				eq(schema.bill.number, billNumber)
			)
		);

	let billId: number;

	if (existingBills.length === 0) {
		const [insertedBill] = await db
			.insert(schema.bill)
			.values({
				type: billType.name,
				submissionSession: billSession,
				number: billNumber,
				title: billTitle,
				submissionDate: submissionDate
			})
			.returning();

		billId = insertedBill.id;
		console.log(`Inserted bill ID: ${billId}`);

		// Insert submission session into bill_session table
		await db.insert(schema.billSession).values({
			billId: billId,
			sessionNumber: billSession,
			isSubmissionSession: true
		});
		console.log(`Inserted bill_session: bill=${billId}, session=${billSession} (submission)`);
	} else {
		billId = existingBills[0].id;
		console.log(`Bill already exists with ID: ${billId}`);

		// Ensure this session is recorded in bill_session (for carry-over bills)
		const existingBillSession = await db
			.select()
			.from(schema.billSession)
			.where(
				and(
					eq(schema.billSession.billId, billId),
					eq(schema.billSession.sessionNumber, startSession)
				)
			);

		if (existingBillSession.length === 0 && startSession !== billSession) {
			// This bill is being carried over to a new session
			await db.insert(schema.billSession).values({
				billId: billId,
				sessionNumber: startSession,
				isSubmissionSession: false
			});
			console.log(`Inserted bill_session: bill=${billId}, session=${startSession} (carry-over)`);
		}
	}

	// Update bill result status
	await db
		.update(schema.bill)
		.set({ result: billResult, resultDate })
		.where(eq(schema.bill.id, billId));

	console.log(`Updated bill result: result=${billResult}, resultDate=${resultDate}`);

	// Process committees
	for (const committee of committees) {
		const committeeId = await getOrCreateCommittee(db, committee.name, committee.chamber);

		const existingCommitteeBills = await db
			.select()
			.from(schema.committeeBill)
			.where(
				and(
					eq(schema.committeeBill.committeeId, committeeId),
					eq(schema.committeeBill.billId, billId),
					eq(schema.committeeBill.session, billSession)
				)
			);

		if (existingCommitteeBills.length === 0) {
			await db.insert(schema.committeeBill).values({
				committeeId,
				billId,
				session: billSession
			});
			console.log(`Inserted committee_bill: committee=${committeeId}, bill=${billId}`);
		}
	}

	// Process Cabinet bill sponsors
	if (billType.name === '閣法' && submissionDate !== null) {
		const submissionDateStr: string = submissionDate;
		const existingSponsors = await db
			.select()
			.from(schema.billSponsors)
			.where(eq(schema.billSponsors.billId, billId));

		if (existingSponsors.length === 0) {
			const cabinets = await db.select().from(schema.cabinet);
			let primeMinisterId: number | null = null;

			for (const cabinet of cabinets) {
				// Convert dates to comparable strings (YYYY-MM-DD format)
				const startDate = String(cabinet.startDate);
				const endDate = cabinet.endDate ? String(cabinet.endDate) : null;

				if (startDate <= submissionDateStr && (!endDate || endDate >= submissionDateStr)) {
					primeMinisterId = cabinet.memberId;
					break;
				}
			}

			if (primeMinisterId) {
				await db.insert(schema.billSponsors).values({ billId, memberId: primeMinisterId });
				console.log(`Inserted bill_sponsor: bill=${billId}, member=${primeMinisterId}`);
			}
		}
	}

	// Process votes
	for (const vote of votes) {
		const votingMethod = VOTING_METHOD_MAP[vote.method];
		if (!votingMethod) {
			console.warn(`Unknown voting method: ${vote.method}`);
			continue;
		}

		// Build the where clause conditionally for null dates
		const whereConditions = [
			eq(schema.billVotes.billId, billId),
			eq(schema.billVotes.chamber, vote.chamber)
		];

		// Check for existing vote
		const existingVotes = await db
			.select()
			.from(schema.billVotes)
			.where(and(...whereConditions))
			.then((results) =>
				results.filter((r) => {
					if (vote.date === null) return r.votingDate === null;
					return r.votingDate === vote.date;
				})
			);

		let voteId: number;
		if (existingVotes.length > 0) {
			voteId = existingVotes[0].id;
			console.log(`Vote already exists with ID: ${voteId}`);
		} else {
			const [insertedVote] = await db
				.insert(schema.billVotes)
				.values({
					billId,
					session: billSession,
					chamber: vote.chamber,
					votingMethod: votingMethod,
					votingDate: vote.date
				})
				.returning();

			voteId = insertedVote.id;
			console.log(`Inserted bill_vote: ${voteId} (${vote.chamber}, ${vote.method})`);
		}

		// Process individual vote results for 押しボタン
		if (vote.method === '押しボタン' && vote.voteUrl) {
			await processVoteResults(db, voteId, vote.voteUrl);
		}
	}
}

/**
 * Process individual vote results from a vote page (BATCHED)
 */
async function processVoteResults(db: DrizzleDB, voteId: number, voteUrl: string): Promise<void> {
	console.log(`Fetching vote results from: ${voteUrl}`);

	try {
		const voteRes = await fetchWithRetry(voteUrl);
		if (voteRes.status !== 200) return;

		const voteBody = await voteRes.text();
		const $vote = load(voteBody);

		// Collect all vote data first
		const voteData: VoteMember[] = [];

		const hasNewStructure = $vote('li.giin').length > 0;
		const hasOldStructure = $vote('td.nam').length > 0;

		if (hasNewStructure) {
			console.log('Using NEW structure (li.giin with span elements)');
			$vote('li.giin').each((_, element) => {
				const $element = $vote(element);
				const memberName = $element.find('span.names').text().trim().replace(/\\s+/g, '');
				if (!memberName) return;

				const prosText = $element.find('span.pros').text().trim();
				const consText = $element.find('span.cons').text().trim();
				if (!prosText && !consText) return;

				voteData.push({ name: memberName, approved: prosText === '賛成' });
			});
		} else if (hasOldStructure) {
			console.log('Using OLD structure (table with td.pro, td.con, td.nam)');
			$vote('tr').each((_, element) => {
				const $element = $vote(element);
				const nameCells = $element.find('td.nam');

				nameCells.each((__, nameCell) => {
					const $nameCell = $vote(nameCell);
					const memberName = $nameCell.text().trim().replace(/\\s+/g, '');
					if (!memberName) return;

					let proCell = null;
					let conCell = null;
					let currentCell = $nameCell.prev();
					while (currentCell.length > 0) {
						if (currentCell.hasClass('con')) conCell = currentCell;
						else if (currentCell.hasClass('pro')) {
							proCell = currentCell;
							break;
						}
						currentCell = currentCell.prev();
					}

					if (!proCell || !conCell) return;

					const hasProImage = proCell.find('img').length > 0;
					const hasConImage = conCell.find('img').length > 0;

					if (hasProImage && !hasConImage) {
						voteData.push({ name: memberName, approved: true });
					} else if (hasConImage && !hasProImage) {
						voteData.push({ name: memberName, approved: false });
					}
				});
			});
		}

		if (voteData.length === 0) {
			console.warn(`No vote data found for ${voteUrl}`);
			return;
		}

		console.log(`Found ${voteData.length} votes to process`);

		// BATCH: Get or create all members at once
		const memberNames = voteData.map((v) => v.name);
		const memberMap = await batchGetOrCreateMembers(db, memberNames);

		// BATCH: Check existing vote results
		const memberIds = [...memberMap.values()];
		const existingResults = await db
			.select()
			.from(schema.billVotesResultMember)
			.where(
				and(
					eq(schema.billVotesResultMember.billVotesId, voteId),
					inArray(schema.billVotesResultMember.memberId, memberIds)
				)
			);

		const existingMemberIds = new Set(existingResults.map((r) => r.memberId));

		// BATCH: Insert new vote results
		const newResults = voteData
			.filter((v) => {
				const memberId = memberMap.get(v.name);
				return memberId && !existingMemberIds.has(memberId);
			})
			.map((v) => ({
				billVotesId: voteId,
				memberId: memberMap.get(v.name)!,
				approved: v.approved
			}));

		if (newResults.length > 0) {
			await db.insert(schema.billVotesResultMember).values(newResults);
			console.log(`Inserted ${newResults.length} vote results`);
		} else {
			console.log('All vote results already exist');
		}
	} catch (err) {
		console.error(`Error fetching vote results from ${voteUrl}:`, err);
	}
}

async function main() {
	const args = parseArgs();
	const DRY_RUN = hasFlag(args, 'dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	const startSession = getPositionalInt(args, 0, DEFAULT_START_SESSION)!;
	const endSession = getPositionalInt(args, 1, DEFAULT_END_SESSION)!;

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

	console.log(`Processing sessions ${startSession} to ${endSession}`);

	try {
		for (let session = startSession; session <= endSession; session++) {
			console.log(`\n=== Processing Session ${session} ===`);
			const sessionUrl = `${BASE_URL}/japanese/joho1/kousei/gian/${session}/gian.htm`;

			try {
				const res = await fetchWithRetry(sessionUrl);
				if (res.status !== 200) {
					console.warn(`Failed to fetch session ${session} page: ${res.status}`);
					continue;
				}

				const body = await res.text();
				const $ = load(body);

				const billTypes: Array<{ name: BillType; selector: string }> = [
					{ name: '閣法', selector: 'h2:contains("法律案（内閣提出）")' },
					{ name: '衆法', selector: 'h2:contains("法律案（衆法）")' },
					{ name: '参法', selector: 'h2:contains("法律案（参法）")' }
				];

				for (const billType of billTypes) {
					console.log(`\nProcessing ${billType.name} bills...`);

					const table = $(billType.selector).next('table');
					if (table.length === 0) continue;

					const rows = table.find('tr');
					for (let i = 0; i < rows.length; i++) {
						const row = rows.eq(i);
						const cells = row.find('td');
						if (cells.length < 3) continue;

						const billSession = parseInt(cells.eq(0).text().trim());
						const billNumber = parseInt(cells.eq(1).text().trim());
						const billTitle = cells.eq(2).text().trim();

						if (billSession < startSession) {
							console.log(
								`Skipping bill ${billType.name}-${billSession}-${billNumber} (session < ${startSession})`
							);
							continue;
						}

						console.log(
							`\nProcessing: ${billType.name}-${billSession}-${billNumber}: ${billTitle}`
						);

						const link = cells.eq(2).find('a').attr('href');
						const billDetailUrl = link ? resolveUrl(sessionUrl, link) : '';

						await processBill(
							db,
							billType,
							billSession,
							billNumber,
							billTitle,
							billDetailUrl,
							startSession,
							DRY_RUN
						);
					}
				}
			} catch (err) {
				console.error(`Error processing session ${session}:`, err);
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
