import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client, { schema });

interface MemberLegislationScore {
	memberId: number;
	memberName: string;
	score: number;
	breakdown: string[];
}

interface LegislationScore {
	billId: number;
	billTitle: string;
	billType: string;
	billNumber: number;
	session: number;
	submissionDate: string | null;
	memberScores: MemberLegislationScore[];
	totalPositive: number;
	totalNegative: number;
	averageScore: number;
}

/**
 * Get all members who were in a group on a specific date.
 * Uses extended logic: assumes group membership continues until a different group is found.
 */
async function getMembersInGroupOnDate(groupId: number, date: string): Promise<number[]> {
	// Get all members who have ever been in this group
	const groupMembers = await db
		.select()
		.from(schema.memberGroup)
		.where(eq(schema.memberGroup.groupId, groupId));

	const memberIds: number[] = [];

	for (const gm of groupMembers) {
		const memberId = gm.memberId;

		// Get all group affiliations for this member, sorted by start date
		const allGroups = await db
			.select()
			.from(schema.memberGroup)
			.where(eq(schema.memberGroup.memberId, memberId));

		// Sort by start date
		const sortedGroups = allGroups.sort((a, b) => {
			const dateA = a.startDate || '0000-01-01';
			const dateB = b.startDate || '0000-01-01';
			return dateA.localeCompare(dateB);
		});

		// If only one group, member is in that group for all time
		if (sortedGroups.length === 1) {
			if (sortedGroups[0].groupId === groupId) {
				memberIds.push(memberId);
			}
			continue;
		}

		// Find which group the member was in on the given date
		let memberGroupOnDate: number | null = null;

		for (let i = 0; i < sortedGroups.length; i++) {
			const currentGroup = sortedGroups[i];
			const nextGroup = i < sortedGroups.length - 1 ? sortedGroups[i + 1] : null;

			const currentStart = currentGroup.startDate || '0000-01-01';
			const extendedEnd = nextGroup ? nextGroup.startDate || '9999-12-31' : '9999-12-31';

			if (date >= currentStart && date < extendedEnd) {
				memberGroupOnDate = currentGroup.groupId;
				break;
			}
		}

		if (memberGroupOnDate === groupId) {
			memberIds.push(memberId);
		}
	}

	return memberIds;
}

/**
 * Get the group a member belonged to on a specific date.
 * Uses extended logic: assumes group membership continues until a different group is found.
 */
async function getMemberGroupOnDate(memberId: number, date: string): Promise<number | null> {
	// Get all group affiliations for this member
	const memberGroups = await db
		.select()
		.from(schema.memberGroup)
		.where(eq(schema.memberGroup.memberId, memberId));

	if (memberGroups.length === 0) {
		return null;
	}

	// Sort by start date
	const sortedGroups = memberGroups.sort((a, b) => {
		const dateA = a.startDate || '0000-01-01';
		const dateB = b.startDate || '0000-01-01';
		return dateA.localeCompare(dateB);
	});

	// If only one group, member is in that group for all time
	if (sortedGroups.length === 1) {
		return sortedGroups[0].groupId;
	}

	// Find which group the member was in on the given date
	for (let i = 0; i < sortedGroups.length; i++) {
		const currentGroup = sortedGroups[i];
		const nextGroup = i < sortedGroups.length - 1 ? sortedGroups[i + 1] : null;

		const currentStart = currentGroup.startDate || '0000-01-01';
		const extendedEnd = nextGroup ? nextGroup.startDate || '9999-12-31' : '9999-12-31';

		if (date >= currentStart && date < extendedEnd) {
			return currentGroup.groupId;
		}
	}

	return null;
}

/**
 * Calculate scores for each legislation
 */
async function calculateLegislationScores(): Promise<LegislationScore[]> {
	// Get all bills
	const bills = await db.select().from(schema.bill);
	console.log(`Processing ${bills.length} bills...`);

	// Get all members
	const members = await db.select().from(schema.member);
	console.log(`Processing ${members.length} members...`);

	const legislationScores: LegislationScore[] = [];

	// Process each bill
	for (const bill of bills) {
		console.log(`Processing Bill ID: ${bill.id}`);

		// Get bill title
		const billTitle = bill.title || '無題';

		// Initialize member scores map for this legislation
		const memberScoresMap = new Map<number, MemberLegislationScore>();

		// Initialize all members with 0 score
		for (const member of members) {
			memberScoresMap.set(member.id, {
				memberId: member.id,
				memberName: member.name,
				score: 0,
				breakdown: []
			});
		}

		// 1. Bill Submission (議案提出)
		// 1a. Bill Sponsors (+10)
		const sponsors = await db
			.select()
			.from(schema.billSponsors)
			.where(eq(schema.billSponsors.billId, bill.id));

		for (const sponsor of sponsors) {
			const memberScore = memberScoresMap.get(sponsor.memberId);
			if (memberScore) {
				memberScore.score += 10;
				memberScore.breakdown.push('Bill Sponsor: +10');
			}
		}

		// 1b. Sponsoring Group
		const sponsorGroups = await db
			.select()
			.from(schema.billSponsorGroups)
			.where(eq(schema.billSponsorGroups.billId, bill.id));

		if (sponsorGroups.length > 0) {
			// Group is specified
			for (const sponsorGroup of sponsorGroups) {
				if (bill.submissionDate) {
					const groupMembers = await getMembersInGroupOnDate(
						sponsorGroup.groupId,
						bill.submissionDate
					);
					for (const memberId of groupMembers) {
						const memberScore = memberScoresMap.get(memberId);
						if (memberScore) {
							memberScore.score += 2;
							memberScore.breakdown.push('Sponsoring Group Member: +2');
						}
					}
				}
			}
		} else {
			// No group specified, use sponsor's group
			if (bill.submissionDate) {
				for (const sponsor of sponsors) {
					const groupId = await getMemberGroupOnDate(sponsor.memberId, bill.submissionDate);
					if (groupId) {
						const groupMembers = await getMembersInGroupOnDate(groupId, bill.submissionDate);
						for (const memberId of groupMembers) {
							const memberScore = memberScoresMap.get(memberId);
							if (memberScore) {
								memberScore.score += 2;
								memberScore.breakdown.push("Sponsor's Group Member: +2");
							}
						}
					}
				}
			}
		}

		// 1c. Bill Supporters (+5)
		const supporters = await db
			.select()
			.from(schema.billSupporters)
			.where(eq(schema.billSupporters.billId, bill.id));

		for (const supporter of supporters) {
			const memberScore = memberScoresMap.get(supporter.memberId);
			if (memberScore) {
				memberScore.score += 5;
				memberScore.breakdown.push('Bill Supporter: +5');
			}
		}

		// 2. Bill Voting (議案採決)
		const votes = await db
			.select()
			.from(schema.billVotes)
			.where(eq(schema.billVotes.billId, bill.id));

		for (const vote of votes) {
			if (!vote.votingDate) continue;

			if (vote.chamber === '衆議院') {
				// House of Representatives
				const groupVotes = await db
					.select()
					.from(schema.billVotesResultGroup)
					.where(eq(schema.billVotesResultGroup.billVotesId, vote.id));

				for (const groupVote of groupVotes) {
					const groupMembers = await getMembersInGroupOnDate(groupVote.groupId, vote.votingDate);
					const scoreChange = groupVote.approved ? 2 : -2;
					const label = groupVote.approved
						? 'House of Representatives - Approved Group: +2'
						: 'House of Representatives - Opposed Group: -2';

					for (const memberId of groupMembers) {
						const memberScore = memberScoresMap.get(memberId);
						if (memberScore) {
							memberScore.score += scoreChange;
							memberScore.breakdown.push(label);
						}
					}
				}
			} else if (vote.chamber === '参議院') {
				// House of Councillors
				const memberVotes = await db
					.select()
					.from(schema.billVotesResultMember)
					.where(eq(schema.billVotesResultMember.billVotesId, vote.id));

				for (const memberVote of memberVotes) {
					const memberScore = memberScoresMap.get(memberVote.memberId);
					if (memberScore) {
						const scoreChange = memberVote.approved ? 5 : -5;
						const label = memberVote.approved
							? 'House of Councillors - Approved: +5'
							: 'House of Councillors - Opposed: -5';

						memberScore.score += scoreChange;
						memberScore.breakdown.push(label);
					}
				}
			}
		}

		// Convert to array and filter out members with 0 score and no breakdown
		const memberScores = Array.from(memberScoresMap.values())
			.filter((m) => m.score !== 0 || m.breakdown.length > 0)
			.sort((a, b) => b.score - a.score);

		// Calculate statistics
		const totalPositive = memberScores.filter((m) => m.score > 0).length;
		const totalNegative = memberScores.filter((m) => m.score < 0).length;
		const averageScore =
			memberScores.length > 0
				? memberScores.reduce((sum, m) => sum + m.score, 0) / memberScores.length
				: 0;

		legislationScores.push({
			billId: bill.id,
			billTitle,
			billType: bill.type,
			billNumber: bill.number,
			session: bill.submissionSession,
			submissionDate: bill.submissionDate,
			memberScores,
			totalPositive,
			totalNegative,
			averageScore
		});
	}

	return legislationScores;
}

/**
 * Generate JSON output
 */
function generateJSON(legislationScores: LegislationScore[]): string {
	return JSON.stringify(legislationScores, null, 2);
}

async function main() {
	console.log('Starting legislation score calculation...\n');

	try {
		const legislationScores = await calculateLegislationScores();

		console.log(`\n=== Processed ${legislationScores.length} bills ===`);

		// Create output directory
		const outputDir = path.join(process.cwd(), 'src', 'lib', 'data');
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		// Generate and save JSON
		const json = generateJSON(legislationScores);
		const jsonPath = path.join(outputDir, 'legislation_scores.json');
		fs.writeFileSync(jsonPath, json);
		console.log(`\n✓ JSON data saved to: ${jsonPath}`);

		console.log('\n✓ Legislation score calculation completed successfully!');
	} catch (error) {
		console.error('Error calculating scores:', error);
		throw error;
	} finally {
		await client.end();
	}
}

main();
