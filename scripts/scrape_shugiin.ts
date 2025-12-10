import { fetch } from 'undici';
import dotenv from 'dotenv';
dotenv.config();
import { load } from 'cheerio';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseJapaneseDate } from './date-utils';

function resolveUrl(base: string, href: string) {
	try {
		return new URL(href, base).toString();
	} catch {
		return href;
	}
}

/**
 * Normalize a member name by:
 * - Removing honorifics (君)
 * - Removing all spaces (both half-width and full-width)
 */
function normalizeMemberName(name: string): string {
	return name
		.replace(/君$/, '') // Remove trailing 君
		.replace(/\u3000/g, '') // Remove full-width space (U+3000)
		.replace(/ /g, '') // Remove half-width space
		.trim();
}

/**
 * Parse member names from a semicolon-separated string.
 * Names may have honorifics like "君" which should be removed.
 * Full-width spaces should be converted to half-width spaces.
 */
function parseMemberNames(text: string): string[] {
	if (!text || text.trim() === '') return [];
	return text
		.split(';')
		.map((name) => normalizeMemberName(name.trim()))
		.filter((name) => name.length > 0);
}

/**
 * Parse sponsor name from 議案提出者 field.
 * This is used as a fallback when 議案提出者一覧 is not available.
 * Handles formats like:
 * - "神谷 宗幣君外四名" -> extracts "神谷宗幣"
 * - "文部科学委員長" -> returns as is (for committee chair lookup)
 */
function parseSponsorFromSingle(text: string): string | null {
	if (!text || text.trim() === '') return null;

	// If it's a committee chair (contains 委員長), return as is
	if (text.includes('委員長')) {
		return text.trim();
	}

	// If it contains "外X名", extract just the first name
	const match = text.match(/^(.+?)外[〇一二三四五六七八九十百千]+名/);
	if (match) {
		return normalizeMemberName(match[1]);
	}

	// Otherwise return the normalized text
	return normalizeMemberName(text);
}

/**
 * Parse group names from a semicolon-separated string.
 */
function parseGroupNames(text: string): string[] {
	if (!text || text.trim() === '') return [];
	return text
		.split(';')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
}

/**
 * Insert or get member from the database.
 */
async function getOrCreateMember(
	db: ReturnType<typeof drizzle>,
	memberName: string
): Promise<number> {
	const existingMember = await db
		.select()
		.from(schema.member)
		.where(eq(schema.member.name, memberName));

	if (existingMember.length > 0) {
		return existingMember[0].id as number;
	}

	const [newMember] = await db
		.insert(schema.member)
		.values({ name: memberName } as any)
		.returning();

	console.log(`  Inserted member: ${memberName} (ID: ${newMember.id})`);
	return newMember.id as number;
}

/**
 * Insert or get group from the database.
 */
async function getOrCreateGroup(
	db: ReturnType<typeof drizzle>,
	groupName: string
): Promise<number> {
	const existingGroup = await db
		.select()
		.from(schema.group)
		.where(eq(schema.group.name, groupName));

	if (existingGroup.length > 0) {
		return existingGroup[0].id as number;
	}

	const [newGroup] = await db
		.insert(schema.group)
		.values({ name: groupName } as any)
		.returning();

	console.log(`  Inserted group: ${groupName} (ID: ${newGroup.id})`);
	return newGroup.id as number;
}

/**
 * Search for committee chair information using the Kokkai API.
 * This is used when the bill sponsor is a committee chair (委員長).
 *
 * Uses the National Diet Library's Proceedings API to find committee meetings
 * and extract the chair's name from the meeting metadata.
 *
 * @param committeeName - The committee name (e.g., "厚生労働委員会")
 * @param submissionSession - The Diet session number
 * @param chamber - The chamber ("衆議院" or "参議院")
 * @returns The committee chair's name, or null if not found
 */
async function searchCommitteeChair(
	committeeName: string,
	submissionSession: number,
	chamber: '衆議院' | '参議院'
): Promise<string | null> {
	try {
		console.log(
			`    Searching for committee chair: ${committeeName} (Session ${submissionSession}, ${chamber})`
		);

		// Use Kokkai API to search for committee meetings
		// API documentation: https://kokkai.ndl.go.jp/api.html
		const params = new URLSearchParams({
			nameOfMeeting: committeeName,
			nameOfHouse: chamber,
			sessionFrom: submissionSession.toString(),
			sessionTo: submissionSession.toString(),
			recordPacking: 'json',
			maximumRecords: '1' // Just need one meeting to get the chair
		});

		const apiUrl = `https://kokkai.ndl.go.jp/api/meeting?${params.toString()}`;
		console.log(`    Kokkai API URL: ${apiUrl}`);

		const res = await fetch(apiUrl);
		if (res.status !== 200) {
			console.warn(`    Failed to fetch from Kokkai API: ${res.status}`);
			return null;
		}

		const data = (await res.json()) as {
			numberOfRecords: number;
			numberOfReturn: number;
			meetingRecord?: Array<{
				nameOfMeeting: string;
				issue: string;
				date: string;
				speechRecord: Array<{
					speechOrder: number;
					speaker: string;
					speech?: string;
				}>;
			}>;
		};

		console.log(`    Found ${data.numberOfRecords} meeting(s)`);

		if (!data.meetingRecord || data.numberOfReturn === 0) {
			console.warn(`    No meetings found for ${committeeName}`);
			return null;
		}

		// Get the first meeting
		const meeting = data.meetingRecord[0];
		console.log(`    Meeting: ${meeting.nameOfMeeting} ${meeting.issue} (${meeting.date})`);

		// Look for the first speech record which contains meeting info
		const meetingInfo = meeting.speechRecord.find(
			(s) => s.speechOrder === 0 && s.speaker === '会議録情報'
		);

		if (!meetingInfo || !meetingInfo.speech) {
			console.warn(`    Could not find meeting info record`);
			return null;
		}

		// Extract chair name from meeting info text
		// The text contains a line like: 委員長 (followed by spaces) 石田 昌宏君
		const pattern = /委員長[\s\u3000]+([^\r\n]+君)/;
		const match = meetingInfo.speech.match(pattern);

		if (match) {
			// Remove 君 suffix and normalize spaces
			const chairName = match[1]
				.replace(/君$/, '')
				.replace(/\s+/g, '')
				.replace(/\u3000/g, '') // Remove full-width space
				.trim();

			console.log(`    ✓ Found committee chair: ${chairName}`);
			return chairName;
		}

		console.warn(`    Could not extract chair name from meeting info`);
		return null;
	} catch (err) {
		console.error(`    Error searching for committee chair:`, err);
		return null;
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

	const baseUrl = 'https://www.shugiin.go.jp';

	// Allow command-line arguments for session range
	const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
	const startSession = args[0] ? parseInt(args[0]) : 213;
	const endSession = args[1] ? parseInt(args[1]) : 219;

	console.log(`Processing sessions ${startSession} to ${endSession}`);

	for (let session = startSession; session <= endSession; session++) {
		console.log(`\n=== Processing Session ${session} ===`);
		const sessionUrl = `${baseUrl}/internet/itdb_gian.nsf/html/gian/kaiji${session}.htm`;

		try {
			const res = await fetch(sessionUrl);
			if (res.status !== 200) {
				console.warn(`Failed to fetch session ${session} page:`, res.status);
				continue;
			}

			// Decode Shift-JIS encoded page
			const buffer = await res.arrayBuffer();
			const decoder = new TextDecoder('shift-jis');
			const body = decoder.decode(buffer);
			const $ = load(body);

			// Collect bills to process
			const billsToProcess: Array<{
				session: number;
				number: number;
				title: string;
				detailUrl: string;
			}> = [];

			// Find all bill rows in tables
			// The structure has tables with bills listed as rows
			$('table tr').each((i, row) => {
				const cells = $(row).find('td');
				if (cells.length < 3) return;

				// Extract bill info from table cells
				// Format: | 提出回次 | 議案番号 | 議案件名 | 審議状況 | 経過 | 本文 |
				const billSession = parseInt(cells.eq(0).text().trim());
				const billNumber = parseInt(cells.eq(1).text().trim());
				const billTitle = cells.eq(2).text().trim();

				// Skip if invalid
				if (isNaN(billSession) || isNaN(billNumber) || !billTitle) return;

				// Get bill detail link (経過 link)
				const detailLink = cells.eq(4).find('a').attr('href');
				if (!detailLink) return;

				const billDetailUrl = resolveUrl(sessionUrl, detailLink);

				billsToProcess.push({
					session: billSession,
					number: billNumber,
					title: billTitle,
					detailUrl: billDetailUrl
				});
			});

			// Process bills sequentially
			for (const bill of billsToProcess) {
				await processBillDetail(db, bill.session, bill.number, bill.title, bill.detailUrl, DRY_RUN);
			}
		} catch (err) {
			console.error(`Error processing session ${session}:`, err);
		}
	}

	console.log('\nDone');
	if (client) await client.end();
}

async function processBillDetail(
	db: ReturnType<typeof drizzle> | null,
	billSession: number,
	billNumber: number,
	billTitle: string,
	billDetailUrl: string,
	DRY_RUN: boolean
) {
	try {
		console.log(`\nFetching bill detail: Session ${billSession}, Number ${billNumber}`);
		console.log(`  Title: ${billTitle}`);
		console.log(`  URL: ${billDetailUrl}`);

		const detailRes = await fetch(billDetailUrl);
		if (detailRes.status !== 200) {
			console.warn(`  Failed to fetch bill detail: ${detailRes.status}`);
			return;
		}

		// Decode Shift-JIS encoded page
		const detailBuffer = await detailRes.arrayBuffer();
		const decoder = new TextDecoder('shift-jis');
		const detailBody = decoder.decode(detailBuffer);
		const $detail = load(detailBody);

		// Extract bill type from the detail page
		let billType: string | null = null;
		let sponsors: string[] = [];
		let sponsorFromSingle: string | null = null; // For 議案提出者 field
		let sponsorGroups: string[] = [];
		let supporters: string[] = [];
		let approvalGroups: string[] = [];
		let rejectionGroups: string[] = [];
		let shugiinVotingDate: string | null = null;

		// Parse the table rows for bill information
		// The table structure uses <TD headers="KOMOKU"> for labels and <TD headers="NAIYO"> for values
		$detail('table tr').each((i, row) => {
			const cells = $detail(row).find('td');
			if (cells.length < 2) return;

			const th = cells.eq(0).find('span').text().trim();
			const td = cells.eq(1).find('span').text().trim();

			if (th === '議案種類' && td) {
				billType = td;
			}

			if (th === '議案提出者一覧' && td) {
				sponsors = parseMemberNames(td);
			}

			if (th === '議案提出者' && td) {
				sponsorFromSingle = parseSponsorFromSingle(td);
			}

			if (th === '議案提出会派' && td) {
				sponsorGroups = parseGroupNames(td);
			}

			if (th === '議案提出の賛成者' && td) {
				supporters = parseMemberNames(td);
			}

			if (th === '衆議院審議時賛成会派' && td) {
				approvalGroups = parseGroupNames(td);
			}

			if (th === '衆議院審議時反対会派' && td) {
				rejectionGroups = parseGroupNames(td);
			}

			if (th === '衆議院審議終了年月日／衆議院審議結果' && td) {
				// Parse date from format like "令和7年11月1日／可決"
				const dateMatch = td.match(/^([^／]+)／/);
				if (dateMatch) {
					shugiinVotingDate = parseJapaneseDate(dateMatch[1]);
				}
			}
		});

		console.log(`  Bill type: ${billType}`);
		console.log(`  Sponsors: ${sponsors.length} members`);
		console.log(`  Sponsor from single: ${sponsorFromSingle}`);
		console.log(`  Sponsor groups: ${sponsorGroups.length} groups`);
		console.log(`  Supporters: ${supporters.length} members`);
		console.log(`  Approval groups: ${approvalGroups.length} groups`);
		console.log(`  Rejection groups: ${rejectionGroups.length} groups`);

		// Only process 衆法, 参法, and 閣法
		if (billType !== '衆法' && billType !== '参法' && billType !== '閣法') {
			console.log(`  Skipping bill type: ${billType}`);
			return;
		}

		// If no sponsors from 議案提出者一覧, use 議案提出者 as fallback
		if (sponsors.length === 0 && sponsorFromSingle) {
			console.log(`  Using 議案提出者 as fallback: ${sponsorFromSingle}`);
			sponsors = [sponsorFromSingle];
		}

		if (DRY_RUN) {
			console.log(`[DRY-RUN] Would process bill: ${billType}-${billSession}-${billNumber}`);
			return;
		}

		// 1. Check if bill exists in database
		const existingBills = await db!
			.select()
			.from(schema.bill)
			.where(
				and(
					eq(schema.bill.type, billType as any),
					eq(schema.bill.submissionSession, billSession),
					eq(schema.bill.number, billNumber)
				)
			);

		if (existingBills.length === 0) {
			console.error(
				`  ERROR: Bill not found in database: ${billType}-${billSession}-${billNumber}`
			);
			console.error(`  Please run scrape_sangiin.ts first to populate the bill database.`);
			return;
		}

		const billId = existingBills[0].id as number;
		console.log(`  Found bill in database with ID: ${billId}`);

		// Process based on bill type (only for member-sponsored bills)
		if (billType === '衆法') {
			// 衆法 processing
			console.log(`\n  Processing 衆法 bill...`);

			// b.i.1. Process sponsors (議案提出者一覧)
			for (const sponsorName of sponsors) {
				const memberId = await getOrCreateMember(db!, sponsorName);

				// Check if sponsor relationship already exists
				const existingSponsors = await db!
					.select()
					.from(schema.billSponsors)
					.where(
						and(eq(schema.billSponsors.billId, billId), eq(schema.billSponsors.memberId, memberId))
					);

				if (existingSponsors.length === 0) {
					await db!.insert(schema.billSponsors).values({
						billId: billId,
						memberId: memberId
					} as any);

					console.log(`  Added sponsor: ${sponsorName} (Member ID: ${memberId})`);
				}
			}

			// b.i.2. Process sponsor groups (議案提出会派)
			for (const groupName of sponsorGroups) {
				const groupId = await getOrCreateGroup(db!, groupName);

				// Check if sponsor group relationship already exists
				const existingSponsorGroups = await db!
					.select()
					.from(schema.billSponsorGroups)
					.where(
						and(
							eq(schema.billSponsorGroups.billId, billId),
							eq(schema.billSponsorGroups.groupId, groupId)
						)
					);

				if (existingSponsorGroups.length === 0) {
					await db!.insert(schema.billSponsorGroups).values({
						billId: billId,
						groupId: groupId
					} as any);

					console.log(`  Added sponsor group: ${groupName} (Group ID: ${groupId})`);
				}
			}

			// b.i.3. Process supporters (議案提出の賛成者)
			for (const supporterName of supporters) {
				const memberId = await getOrCreateMember(db!, supporterName);

				// Check if supporter relationship already exists
				const existingSupporters = await db!
					.select()
					.from(schema.billSupporters)
					.where(
						and(
							eq(schema.billSupporters.billId, billId),
							eq(schema.billSupporters.memberId, memberId)
						)
					);

				if (existingSupporters.length === 0) {
					await db!.insert(schema.billSupporters).values({
						billId: billId,
						memberId: memberId
					} as any);

					console.log(`  Added supporter: ${supporterName} (Member ID: ${memberId})`);
				}
			}
		} else if (billType === '参法') {
			// 参法 processing
			console.log(`\n  Processing 参法 bill...`);

			// ii.1. Process sponsors
			for (const sponsorName of sponsors) {
				const memberId = await getOrCreateMember(db!, sponsorName);

				// Check if sponsor relationship already exists
				const existingSponsors = await db!
					.select()
					.from(schema.billSponsors)
					.where(
						and(eq(schema.billSponsors.billId, billId), eq(schema.billSponsors.memberId, memberId))
					);

				if (existingSponsors.length === 0) {
					await db!.insert(schema.billSponsors).values({
						billId: billId,
						memberId: memberId
					} as any);

					console.log(`  Added sponsor: ${sponsorName} (Member ID: ${memberId})`);
				}
			}

			// ii.c. Check if sponsor is a committee chair (委員長)
			// If the sponsor list contains "委員長", we need to search for the actual name
			if (sponsors.some((name) => name.includes('委員長'))) {
				console.log(`  Bill sponsor is a committee chair, searching for actual name...`);

				// Extract committee name from the sponsor field
				// e.g., "厚生労働委員長" -> "厚生労働委員会"
				const committeeChairName = sponsors.find((name) => name.includes('委員長'));
				if (committeeChairName) {
					const committeeName = committeeChairName.replace('委員長', '委員会');
					const chamber = '参議院'; // 参法 bills are from 参議院

					const chairName = await searchCommitteeChair(committeeName, billSession, chamber);

					if (chairName) {
						const chairMemberId = await getOrCreateMember(db!, chairName);

						// Check if already added
						const existingSponsors = await db!
							.select()
							.from(schema.billSponsors)
							.where(
								and(
									eq(schema.billSponsors.billId, billId),
									eq(schema.billSponsors.memberId, chairMemberId)
								)
							);

						if (existingSponsors.length === 0) {
							await db!.insert(schema.billSponsors).values({
								billId: billId,
								memberId: chairMemberId
							} as any);

							console.log(
								`  Added committee chair as sponsor: ${chairName} (Member ID: ${chairMemberId})`
							);
						}
					}
				}
			}
		} // d. Process voting groups (衆議院審議時賛成会派・衆議院審議時反対会派)
		// This applies to ALL bill types (閣法, 衆法, 参法)
		if (approvalGroups.length > 0 || rejectionGroups.length > 0) {
			console.log(`\n  Processing voting groups...`);
			console.log(`  Voting date: ${shugiinVotingDate}`);
			console.log(`  Approval groups: ${approvalGroups.join(', ')}`);
			console.log(`  Rejection groups: ${rejectionGroups.join(', ')}`);

			if (!shugiinVotingDate) {
				console.warn(`  WARNING: No voting date found, cannot link to bill_votes`);
			} else {
				// Find matching bill_votes entry
				const existingVotes = await db!
					.select()
					.from(schema.billVotes)
					.where(
						and(
							eq(schema.billVotes.billId, billId),
							eq(schema.billVotes.chamber, '衆議院'),
							eq(schema.billVotes.votingDate, shugiinVotingDate)
						)
					);

				console.log(`  Found ${existingVotes.length} matching bill_votes entries`);

				if (existingVotes.length === 0) {
					// Try to find any vote for this bill in 衆議院
					const anyVotes = await db!
						.select()
						.from(schema.billVotes)
						.where(
							and(eq(schema.billVotes.billId, billId), eq(schema.billVotes.chamber, '衆議院'))
						);

					console.error(
						`  ERROR: No bill_votes entry found for bill ${billId} with voting date ${shugiinVotingDate}`
					);
					if (anyVotes.length > 0) {
						console.error(`  However, found ${anyVotes.length} vote(s) for this bill in 衆議院:`);
						anyVotes.forEach((vote) => {
							console.error(
								`    - Vote ID ${vote.id}: date=${vote.votingDate}, method=${vote.votingMethod}`
							);
						});
					}
					console.error(`  Please ensure the voting record exists in the database first.`);
				} else {
					const voteId = existingVotes[0].id as number;
					console.log(`  Found bill_votes entry with ID: ${voteId}`);

					// Process approval groups
					for (const groupName of approvalGroups) {
						const groupId = await getOrCreateGroup(db!, groupName);

						// Check if group vote result already exists
						const existingResults = await db!
							.select()
							.from(schema.billVotesResultGroup)
							.where(
								and(
									eq(schema.billVotesResultGroup.billVotesId, voteId),
									eq(schema.billVotesResultGroup.groupId, groupId)
								)
							);

						if (existingResults.length === 0) {
							await db!.insert(schema.billVotesResultGroup).values({
								billVotesId: voteId,
								groupId: groupId,
								approved: true
							} as any);

							console.log(`  Added approval group: ${groupName} (Group ID: ${groupId})`);
						}
					}

					// Process rejection groups
					for (const groupName of rejectionGroups) {
						const groupId = await getOrCreateGroup(db!, groupName);

						// Check if group vote result already exists
						const existingResults = await db!
							.select()
							.from(schema.billVotesResultGroup)
							.where(
								and(
									eq(schema.billVotesResultGroup.billVotesId, voteId),
									eq(schema.billVotesResultGroup.groupId, groupId)
								)
							);

						if (existingResults.length === 0) {
							await db!.insert(schema.billVotesResultGroup).values({
								billVotesId: voteId,
								groupId: groupId,
								approved: false
							} as any);

							console.log(`  Added rejection group: ${groupName} (Group ID: ${groupId})`);
						}
					}
				}
			}
		}

		console.log(`  Successfully processed bill: ${billType}-${billSession}-${billNumber}`);
	} catch (err) {
		console.error(
			`Error processing bill detail (Session ${billSession}, Number ${billNumber}):`,
			err
		);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
