import { fetch } from 'undici';
import dotenv from 'dotenv';
dotenv.config();
import { load } from 'cheerio';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseJapaneseDate } from '../src/dateUtils';
/* eslint-disable @typescript-eslint/no-explicit-any */

function resolveUrl(base: string, href: string) {
	try {
		return new URL(href, base).toString();
	} catch {
		return href;
	}
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;
	const DRY_RUN = process.argv.includes('--dry-run');

	if (!DATABASE_URL && !DRY_RUN) {
		console.error(
			'DATABASE_URL is not set. Provide DATABASE_URL or run with --dry-run to skip DB writes.'
		);
		process.exit(1);
	}

	let client: ReturnType<typeof postgres> | null = null;
	let db: ReturnType<typeof drizzle> | null = null;
	if (!DRY_RUN && DATABASE_URL) {
		client = postgres(DATABASE_URL);
		db = drizzle(client, { schema });
	}

	const baseUrl = 'https://www.sangiin.go.jp';

	// Allow command-line arguments for session range (for testing)
	const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
	const startSession = args[0] ? parseInt(args[0]) : 198;
	const endSession = args[1] ? parseInt(args[1]) : 219; // Today is Nov 2, 2025, session 219

	console.log(`Processing sessions ${startSession} to ${endSession}`);

	for (let session = startSession; session <= endSession; session++) {
		console.log(`\n=== Processing Session ${session} ===`);
		const sessionUrl = `${baseUrl}/japanese/joho1/kousei/gian/${session}/gian.htm`;

		try {
			const res = await fetch(sessionUrl);
			if (res.status !== 200) {
				console.warn(`Failed to fetch session ${session} page:`, res.status);
				continue;
			}

			const body = await res.text();
			const $ = load(body);

			// Process 閣法 (Cabinet bills), 衆法 (House of Representatives bills), 参法 (House of Councillors bills)
			const billTypes = [
				{ name: '閣法', selector: 'h2:contains("法律案（内閣提出）")' },
				{ name: '衆法', selector: 'h2:contains("法律案（衆法）")' },
				{ name: '参法', selector: 'h2:contains("法律案（参法）")' }
			];

			for (const billType of billTypes) {
				console.log(`\nProcessing ${billType.name} bills...`);

				// Find the table after the relevant header
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

					// Skip if not matching our target session
					if (billSession < startSession) {
						console.log(
							`Skipping bill ${billType.name}-${billSession}-${billNumber} (session < ${startSession})`
						);
						continue;
					}

					console.log(`\nProcessing: ${billType.name}-${billSession}-${billNumber}: ${billTitle}`);

					// Get bill detail link if available
					const link = cells.eq(2).find('a').attr('href');
					let billDetailUrl = '';
					if (link) {
						billDetailUrl = resolveUrl(sessionUrl, link);
					}

					let submissionDate: string | null = null;
					let deliberationCompleted = false;
					let passed = false;
					const committees: Array<{ name: string; chamber: '衆議院' | '参議院' }> = [];
					const votes: Array<{
						chamber: '衆議院' | '参議院';
						method: string;
						date: string | null;
						voteUrl?: string;
					}> = [];

					// Fetch bill detail page to extract more information
					if (billDetailUrl) {
						try {
							const detailRes = await fetch(billDetailUrl);
							if (detailRes.status === 200) {
								const detailBody = await detailRes.text();
								const $detail = load(detailBody);

								// Extract submission date and promulgation date from table rows
								$detail('table tr').each((i, row) => {
									const th = $detail(row).find('th').text().trim();
									const td = $detail(row).find('td').text().trim();

									if (th === '提出日' && td && td !== '　' && td !== '') {
										const parsedDate = parseJapaneseDate(td);
										if (parsedDate) {
											submissionDate = parsedDate;
										}
									}

									// Extract promulgation date (公布年月日)
									if (th === '公布年月日' && td && td !== '　' && td !== '') {
										const pubDate = parseJapaneseDate(td);
										if (pubDate) {
											deliberationCompleted = true;
											passed = true;
										}
									}
								});

								// Extract committees from both chambers
								const processChamberCommittees = (chamberName: '衆議院' | '参議院') => {
									$detail('table').each((i, table) => {
										const tableHeader = $detail(table).find('th[colspan="2"]').text().trim();
										if (tableHeader.includes(`${chamberName}委員会等経過`)) {
											$detail(table)
												.find('tr')
												.each((j, row) => {
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

								// Extract voting information from both chambers
								const processChamberVotes = (chamberName: '衆議院' | '参議院') => {
									$detail('table').each((i, table) => {
										const tableHeader = $detail(table).find('th[colspan="2"]').text().trim();
										if (tableHeader.includes(`${chamberName}本会議経過`)) {
											let voteMethod: string | null = null;
											let voteDate: string | null = null;
											let voteUrl: string | null = null;

											$detail(table)
												.find('tr')
												.each((j, row) => {
													const th = $detail(row).find('th').text().trim();
													const td = $detail(row).find('td');
													const tdText = td.text().trim();

													if (th === '採決方法' && tdText && tdText !== '　') {
														// Extract just the method name, removing the link text
														voteMethod = tdText.split('（')[0].trim();
														// Check for vote result link
														const link = td.find('a');
														if (link.length > 0) {
															const href = link.attr('href');
															if (href) {
																voteUrl = resolveUrl(billDetailUrl, href);
															}
														}
													}

													if (th === '議決日' && tdText && tdText !== '　') {
														voteDate = parseJapaneseDate(tdText);
													}
												});

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
							}
						} catch (err) {
							console.error(`Error fetching bill detail for ${billDetailUrl}:`, err);
						}
					}

					// Database operations
					if (DRY_RUN) {
						console.log(
							`[DRY-RUN] Would insert/update bill: ${billType.name}-${billSession}-${billNumber}`
						);
						console.log(`  Title: ${billTitle}`);
						console.log(`  Submission Date: ${submissionDate}`);
						console.log(`  Deliberation Completed: ${deliberationCompleted}`);
						console.log(`  Passed: ${passed}`);
						console.log(`  Committees: ${JSON.stringify(committees)}`);
						console.log(`  Votes: ${JSON.stringify(votes)}`);
					} else {
						// 2a. Check if bill exists
						const existingBills = await db!
							.select()
							.from(schema.bill)
							.where(
								and(
									eq(schema.bill.type, billType.name as any),
									eq(schema.bill.submissionSession, billSession),
									eq(schema.bill.number, billNumber)
								)
							);

						let billId: number;

						if (existingBills.length === 0) {
							// 2a.i. Insert new bill
							const [insertedBill] = await db!
								.insert(schema.bill)
								.values({
									type: billType.name as any,
									submissionSession: billSession,
									number: billNumber,
									submissionDate: submissionDate,
									deliberationCompleted: false,
									passed: false
								} as any)
								.returning();

							billId = insertedBill.id as number;
							console.log(`Inserted bill ID: ${billId}`);

							// 2a.ii. Insert bill_detail
							await db!.insert(schema.billDetail).values({
								billId: billId,
								title: billTitle
							} as any);

							console.log(`Inserted bill_detail for bill ID: ${billId}`);
						} else {
							billId = existingBills[0].id as number;
							console.log(`Bill already exists with ID: ${billId}`);

							// Set deliberation_complete to false when starting to process the bill
							await db!
								.update(schema.bill)
								.set({
									deliberationCompleted: false
								})
								.where(eq(schema.bill.id, billId));
						}

						// 2b. Update deliberation status
						// For the endSession, don't set deliberationCompleted to true
						// This allows us to track if bills appear in future sessions
						const shouldMarkComplete = deliberationCompleted && session !== endSession;
						await db!
							.update(schema.bill)
							.set({
								deliberationCompleted: shouldMarkComplete,
								passed: passed
							})
							.where(eq(schema.bill.id, billId));

						console.log(
							`Updated bill deliberation status: completed=${shouldMarkComplete}, passed=${passed}`
						);

						// 2c & 2d. Process committees
						for (const committee of committees) {
							let committeeId: number | null = null;

							// Check if committee exists with matching chamber
							const existingCommittees = await db!
								.select()
								.from(schema.committee)
								.where(
									and(
										eq(schema.committee.name, committee.name),
										eq(schema.committee.chamber, committee.chamber)
									)
								);

							if (existingCommittees.length > 0) {
								committeeId = existingCommittees[0].id as number;
								console.log(
									`Committee exists: ${committee.name} (${committee.chamber}) ID: ${committeeId}`
								);
							} else {
								// Insert new committee
								const [insertedCommittee] = await db!
									.insert(schema.committee)
									.values({
										chamber: committee.chamber,
										name: committee.name
									} as any)
									.returning();

								committeeId = insertedCommittee.id as number;
								console.log(
									`Inserted committee: ${committee.name} (${committee.chamber}) ID: ${committeeId}`
								);
							}

							// Insert into committee_bill if not exists
							const existingCommitteeBills = await db!
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
								await db!.insert(schema.committeeBill).values({
									committeeId: committeeId,
									billId: billId,
									session: billSession
								} as any);

								console.log(
									`Inserted committee_bill: committee=${committeeId}, bill=${billId}, session=${billSession}`
								);
							}
						}

						// 2e. Process Cabinet bill sponsors (閣法)
						if (billType.name === '閣法' && submissionDate) {
							const existingSponsors = await db!
								.select()
								.from(schema.billSponsors)
								.where(eq(schema.billSponsors.billId, billId));

							if (existingSponsors.length === 0) {
								// Find Cabinet member serving on submission date
								const cabinets = await db!.select().from(schema.cabinet);

								let primeMinisterId: number | null = null;
								const submissionDateStr: string = submissionDate; // Type assertion - already checked above
								for (const cabinet of cabinets) {
									const startDate = cabinet.startDate
										? new Date(cabinet.startDate).toISOString().slice(0, 10)
										: null;
									const endDate = cabinet.endDate
										? new Date(cabinet.endDate).toISOString().slice(0, 10)
										: null;

									if (
										startDate &&
										startDate <= submissionDateStr &&
										(!endDate || endDate >= submissionDateStr)
									) {
										primeMinisterId = cabinet.memberId as number;
										break;
									}
								}

								if (primeMinisterId) {
									await db!.insert(schema.billSponsors).values({
										billId: billId,
										memberId: primeMinisterId
									} as any);

									console.log(`Inserted bill_sponsor: bill=${billId}, member=${primeMinisterId}`);
								} else {
									console.warn(`No Prime Minister found for submission date: ${submissionDate}`);
								}
							}
						}

						// 2f & 2g. Process votes
						for (const vote of votes) {
							// Map voting method to enum (handle variations in website data)
							const votingMethodMap: Record<string, any> = {
								異議なし採決: '異議なし採決',
								異議の有無: '異議なし採決', // Variation from website
								起立投票: '起立投票',
								起立: '起立投票', // Variation from website
								記名投票: '記名投票',
								押しボタン: '押しボタン'
							};

							const votingMethod = votingMethodMap[vote.method];
							if (!votingMethod) {
								console.warn(`Unknown voting method: ${vote.method}`);
								continue;
							}

							// Insert bill_votes
							const [insertedVote] = await db!
								.insert(schema.billVotes)
								.values({
									billId: billId,
									chamber: vote.chamber,
									votingMethod: votingMethod,
									votingDate: vote.date
								} as any)
								.returning();

							const voteId = insertedVote.id as number;
							console.log(`Inserted bill_vote: ${voteId} (${vote.chamber}, ${vote.method})`);

							// 2g.ii. Process individual vote results for 押しボタン
							if (vote.method === '押しボタン' && vote.voteUrl) {
								try {
									const voteRes = await fetch(vote.voteUrl);
									if (voteRes.status === 200) {
										const voteBody = await voteRes.text();
										const $vote = load(voteBody);

										// Parse vote results using the discovered HTML structure
										// Structure: Each TR has 3 members, each with: <TD class="pro">...<TD class="con">...<TD class="nam"><TT>Name</TT></TD>
										let voteCount = 0;
										const votePromises: Promise<void>[] = [];

										$vote('table tr').each((i, row) => {
											const cells = $vote(row).find('td');

											// Check if this row has vote data (has class="nam" cells)
											const namCells = cells.filter('.nam');
											if (namCells.length === 0) return;

											// Process each member in this row (typically 3 members per row)
											// Each member has 3 cells: pro, con, nam
											for (let cellIdx = 0; cellIdx < cells.length; cellIdx += 3) {
												if (cellIdx + 2 >= cells.length) break;

												const proCell = $vote(cells[cellIdx]);
												const conCell = $vote(cells[cellIdx + 1]);
												const namCell = $vote(cells[cellIdx + 2]);

												// Check if this is a name cell
												if (!namCell.hasClass('nam')) continue;

												const memberName = namCell.find('tt').text().trim().replace(/\s+/g, ' ');
												if (!memberName) continue;

												// Determine if this is an approval or rejection vote
												const hasProImage = proCell.find('img').length > 0;
												const hasConImage = conCell.find('img').length > 0;

												// If neither has an image, skip (likely absent)
												if (!hasProImage && !hasConImage) continue;

												const approved = hasProImage; // True if pro has image, false if con has image

												// Process this vote asynchronously
												const votePromise = (async () => {
													// Insert or get member
													const existingMember = await db!
														.select()
														.from(schema.member)
														.where(eq(schema.member.name, memberName));

													let memberId: number;
													if (existingMember.length > 0) {
														memberId = existingMember[0].id as number;
													} else {
														const [newMember] = await db!
															.insert(schema.member)
															.values({ name: memberName } as any)
															.returning();
														memberId = newMember.id as number;
														console.log(`Inserted member: ${memberName} (${memberId})`);
													}

													// Insert vote result
													await db!.insert(schema.billVotesResultMember).values({
														billVotesId: voteId,
														memberId: memberId,
														approved: approved
													} as any);

													console.log(
														`Vote recorded: ${memberName} - ${approved ? '賛成' : '反対'}`
													);
													voteCount++;
												})();

												votePromises.push(votePromise);
											}
										});

										// Wait for all vote processing to complete
										await Promise.all(votePromises);

										console.log(`Processed ${voteCount} individual votes from ${vote.voteUrl}`);
									}
								} catch (err) {
									console.error(`Error fetching vote results from ${vote.voteUrl}:`, err);
								}
							}
						}

						// 2h. Update bill if promulgated
						// (Already handled in promulgation detection above)
					}
				}
			}
		} catch (err) {
			console.error(`Error processing session ${session}:`, err);
		}
	}

	console.log('\nDone');
	if (client) await client.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
