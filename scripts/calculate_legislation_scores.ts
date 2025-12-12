import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
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

// Cache types for pre-loaded data
interface CachedData {
	members: schema.Member[];
	memberById: Map<number, schema.Member>;
	groups: schema.Group[];
	groupById: Map<number, schema.Group>;
	memberGroups: schema.MemberGroup[];
	memberGroupsByMemberId: Map<number, schema.MemberGroup[]>;
	memberGroupsByGroupId: Map<number, schema.MemberGroup[]>;
	memberParties: schema.MemberParty[];
	memberPartiesByMemberId: Map<number, schema.MemberParty[]>;
	billSponsors: schema.BillSponsor[];
	billSponsorsByBillId: Map<number, schema.BillSponsor[]>;
	billSponsorGroups: schema.BillSponsorGroup[];
	billSponsorGroupsByBillId: Map<number, schema.BillSponsorGroup[]>;
	billSupporters: schema.BillSupporter[];
	billSupportersByBillId: Map<number, schema.BillSupporter[]>;
	billVotes: schema.BillVote[];
	billVotesByBillId: Map<number, schema.BillVote[]>;
	billVotesResultGroups: schema.BillVotesResultGroup[];
	billVotesResultGroupsByVoteId: Map<number, schema.BillVotesResultGroup[]>;
	billVotesResultMembers: schema.BillVotesResultMember[];
	billVotesResultMembersByVoteId: Map<number, schema.BillVotesResultMember[]>;
}

/**
 * Pre-load all required data from the database for efficient processing.
 */
async function loadAllData(): Promise<CachedData> {
	console.log('Loading all data from database...');

	const [
		members,
		groups,
		memberGroups,
		memberParties,
		billSponsors,
		billSponsorGroups,
		billSupporters,
		billVotes,
		billVotesResultGroups,
		billVotesResultMembers
	] = await Promise.all([
		db.select().from(schema.member),
		db.select().from(schema.group),
		db.select().from(schema.memberGroup),
		db.select().from(schema.memberParty),
		db.select().from(schema.billSponsors),
		db.select().from(schema.billSponsorGroups),
		db.select().from(schema.billSupporters),
		db.select().from(schema.billVotes),
		db.select().from(schema.billVotesResultGroup),
		db.select().from(schema.billVotesResultMember)
	]);

	console.log(`  - Members: ${members.length}`);
	console.log(`  - Groups: ${groups.length}`);
	console.log(`  - Member-Group relations: ${memberGroups.length}`);
	console.log(`  - Member-Party relations: ${memberParties.length}`);
	console.log(`  - Bill sponsors: ${billSponsors.length}`);
	console.log(`  - Bill sponsor groups: ${billSponsorGroups.length}`);
	console.log(`  - Bill supporters: ${billSupporters.length}`);
	console.log(`  - Bill votes: ${billVotes.length}`);

	// Build lookup maps
	const memberById = new Map(members.map((m) => [m.id, m]));
	const groupById = new Map(groups.map((g) => [g.id, g]));

	const memberGroupsByMemberId = new Map<number, schema.MemberGroup[]>();
	const memberGroupsByGroupId = new Map<number, schema.MemberGroup[]>();
	for (const mg of memberGroups) {
		if (!memberGroupsByMemberId.has(mg.memberId)) {
			memberGroupsByMemberId.set(mg.memberId, []);
		}
		memberGroupsByMemberId.get(mg.memberId)!.push(mg);

		if (!memberGroupsByGroupId.has(mg.groupId)) {
			memberGroupsByGroupId.set(mg.groupId, []);
		}
		memberGroupsByGroupId.get(mg.groupId)!.push(mg);
	}

	const memberPartiesByMemberId = new Map<number, schema.MemberParty[]>();
	for (const mp of memberParties) {
		if (!memberPartiesByMemberId.has(mp.memberId)) {
			memberPartiesByMemberId.set(mp.memberId, []);
		}
		memberPartiesByMemberId.get(mp.memberId)!.push(mp);
	}

	const billSponsorsByBillId = new Map<number, schema.BillSponsor[]>();
	for (const bs of billSponsors) {
		if (!billSponsorsByBillId.has(bs.billId)) {
			billSponsorsByBillId.set(bs.billId, []);
		}
		billSponsorsByBillId.get(bs.billId)!.push(bs);
	}

	const billSponsorGroupsByBillId = new Map<number, schema.BillSponsorGroup[]>();
	for (const bsg of billSponsorGroups) {
		if (!billSponsorGroupsByBillId.has(bsg.billId)) {
			billSponsorGroupsByBillId.set(bsg.billId, []);
		}
		billSponsorGroupsByBillId.get(bsg.billId)!.push(bsg);
	}

	const billSupportersByBillId = new Map<number, schema.BillSupporter[]>();
	for (const bs of billSupporters) {
		if (!billSupportersByBillId.has(bs.billId)) {
			billSupportersByBillId.set(bs.billId, []);
		}
		billSupportersByBillId.get(bs.billId)!.push(bs);
	}

	const billVotesByBillId = new Map<number, schema.BillVote[]>();
	for (const bv of billVotes) {
		if (!billVotesByBillId.has(bv.billId)) {
			billVotesByBillId.set(bv.billId, []);
		}
		billVotesByBillId.get(bv.billId)!.push(bv);
	}

	const billVotesResultGroupsByVoteId = new Map<number, schema.BillVotesResultGroup[]>();
	for (const vrg of billVotesResultGroups) {
		if (!billVotesResultGroupsByVoteId.has(vrg.billVotesId)) {
			billVotesResultGroupsByVoteId.set(vrg.billVotesId, []);
		}
		billVotesResultGroupsByVoteId.get(vrg.billVotesId)!.push(vrg);
	}

	const billVotesResultMembersByVoteId = new Map<number, schema.BillVotesResultMember[]>();
	for (const vrm of billVotesResultMembers) {
		if (!billVotesResultMembersByVoteId.has(vrm.billVotesId)) {
			billVotesResultMembersByVoteId.set(vrm.billVotesId, []);
		}
		billVotesResultMembersByVoteId.get(vrm.billVotesId)!.push(vrm);
	}

	console.log('Data loading complete.\n');

	return {
		members,
		memberById,
		groups,
		groupById,
		memberGroups,
		memberGroupsByMemberId,
		memberGroupsByGroupId,
		memberParties,
		memberPartiesByMemberId,
		billSponsors,
		billSponsorsByBillId,
		billSponsorGroups,
		billSponsorGroupsByBillId,
		billSupporters,
		billSupportersByBillId,
		billVotes,
		billVotesByBillId,
		billVotesResultGroups,
		billVotesResultGroupsByVoteId,
		billVotesResultMembers,
		billVotesResultMembersByVoteId
	};
}

/**
 * Get extended group membership dates for a member using memberParty data.
 *
 * Logic:
 * - Find the memberParty record that includes the group's startDate (for extending to earlier start)
 * - Find the memberParty record that includes the group's endDate (for extending to later end)
 * - Use party start_date and end_date to determine actual boundaries
 *
 * Example:
 * 衆議院: 自由民主党 (2019-02-08 to 2019-02-28)
 * 衆議院: 自由民主党・無所属の会 (2020-02-03 to 2021-01-25)
 *
 * For 自由民主党:
 *   - Extended start: start_date of party that contains 2019-02-08
 *   - Extended end: start_date of next group (2020-02-03)
 *
 * For 自由民主党・無所属の会:
 *   - Extended start: end of previous group (2019-02-28)
 *   - Extended end: end_date of party that contains 2021-01-25
 */
function getExtendedGroupDates(
	memberId: number,
	group: schema.MemberGroup,
	allMemberGroups: schema.MemberGroup[],
	memberParties: schema.MemberParty[],
	groupChamber: string | null
): { extendedStart: string; extendedEnd: string } {
	const groupStartDate = group.startDate || '0000-01-01';
	const groupEndDate = group.endDate || '9999-12-31';

	// Filter member groups by chamber (using group lookup)
	// Sort all groups for this member in the same chamber by start date
	const sortedGroups = allMemberGroups
		.filter((mg) => mg.memberId === memberId)
		.sort((a, b) => {
			const dateA = a.startDate || '0000-01-01';
			const dateB = b.startDate || '0000-01-01';
			return dateA.localeCompare(dateB);
		});

	// Find current group index
	const currentIndex = sortedGroups.findIndex((mg) => mg.id === group.id);
	const prevGroup = currentIndex > 0 ? sortedGroups[currentIndex - 1] : null;
	const nextGroup = currentIndex < sortedGroups.length - 1 ? sortedGroups[currentIndex + 1] : null;

	// Filter member parties by chamber
	const partyRecords = memberParties.filter(
		(mp) => mp.memberId === memberId && mp.chamber === groupChamber
	);

	// Find party that contains the group's start date
	let extendedStart = groupStartDate;
	const partyAtStart = partyRecords.find((mp) => {
		const pStart = mp.startDate || '0000-01-01';
		const pEnd = mp.endDate || '9999-12-31';
		return groupStartDate >= pStart && groupStartDate <= pEnd;
	});
	if (partyAtStart) {
		// Use party's start date, but not earlier than previous group's end
		const partyStart = partyAtStart.startDate || '0000-01-01';
		const prevEnd = prevGroup
			? prevGroup.endDate || prevGroup.startDate || '0000-01-01'
			: '0000-01-01';
		extendedStart = partyStart > prevEnd ? partyStart : prevEnd;
	}

	// Find party that contains the group's end date
	let extendedEnd = groupEndDate;
	const partyAtEnd = partyRecords.find((mp) => {
		const pStart = mp.startDate || '0000-01-01';
		const pEnd = mp.endDate || '9999-12-31';
		return groupEndDate >= pStart && groupEndDate <= pEnd;
	});
	if (partyAtEnd) {
		// Use party's end date, but not later than next group's start
		const partyEnd = partyAtEnd.endDate || '9999-12-31';
		const nextStart = nextGroup ? nextGroup.startDate || '9999-12-31' : '9999-12-31';
		extendedEnd = partyEnd < nextStart ? partyEnd : nextStart;
	} else if (nextGroup) {
		// No party found, use next group's start as boundary
		extendedEnd = nextGroup.startDate || '9999-12-31';
	}

	return { extendedStart, extendedEnd };
}

/**
 * Get all members who were in a group on a specific date.
 * Uses extended logic with memberParty dates and considers chamber.
 */
function getMembersInGroupOnDate(groupId: number, date: string, cache: CachedData): number[] {
	const group = cache.groupById.get(groupId);
	if (!group) return [];

	const groupChamber = group.chamber;
	const groupMembers = cache.memberGroupsByGroupId.get(groupId) || [];
	const memberIds: number[] = [];

	for (const gm of groupMembers) {
		const memberId = gm.memberId;

		// Get all group affiliations for this member in the same chamber
		const allMemberGroups = (cache.memberGroupsByMemberId.get(memberId) || []).filter((mg) => {
			const g = cache.groupById.get(mg.groupId);
			return g && g.chamber === groupChamber;
		});

		// Get member parties
		const memberParties = cache.memberPartiesByMemberId.get(memberId) || [];

		// Get extended dates for this specific group membership
		const { extendedStart, extendedEnd } = getExtendedGroupDates(
			memberId,
			gm,
			allMemberGroups,
			memberParties,
			groupChamber
		);

		// Check if date falls within extended range
		if (date >= extendedStart && date < extendedEnd) {
			memberIds.push(memberId);
		}
	}

	return memberIds;
}

/**
 * Get the group a member belonged to on a specific date for a specific chamber.
 * Uses extended logic with memberParty dates.
 */
function getMemberGroupOnDate(
	memberId: number,
	date: string,
	chamber: string | null,
	cache: CachedData
): number | null {
	// Get all group affiliations for this member in the specified chamber
	const memberGroups = (cache.memberGroupsByMemberId.get(memberId) || []).filter((mg) => {
		const g = cache.groupById.get(mg.groupId);
		return g && (chamber === null || g.chamber === chamber);
	});

	if (memberGroups.length === 0) {
		return null;
	}

	// Get member parties
	const memberParties = cache.memberPartiesByMemberId.get(memberId) || [];

	// Check each group with extended dates
	for (const mg of memberGroups) {
		const group = cache.groupById.get(mg.groupId);
		if (!group) continue;

		const { extendedStart, extendedEnd } = getExtendedGroupDates(
			memberId,
			mg,
			memberGroups,
			memberParties,
			group.chamber
		);

		if (date >= extendedStart && date < extendedEnd) {
			return mg.groupId;
		}
	}

	return null;
}

/**
 * Calculate scores for each legislation using pre-loaded cached data.
 */
async function calculateLegislationScores(cache: CachedData): Promise<LegislationScore[]> {
	// Get all bills
	const bills = await db.select().from(schema.bill);
	console.log(`Processing ${bills.length} bills...`);

	const legislationScores: LegislationScore[] = [];

	// Process each bill
	for (let i = 0; i < bills.length; i++) {
		const bill = bills[i];

		if ((i + 1) % 100 === 0 || i === bills.length - 1) {
			console.log(`Processing bill ${i + 1}/${bills.length}...`);
		}

		// Get bill title
		const billTitle = bill.title || '無題';

		// Initialize member scores map for this legislation
		const memberScoresMap = new Map<number, MemberLegislationScore>();

		// Initialize all members with 0 score
		for (const member of cache.members) {
			memberScoresMap.set(member.id, {
				memberId: member.id,
				memberName: member.names[0], // Use primary name
				score: 0,
				breakdown: []
			});
		}

		// Track sponsors to avoid double counting
		const sponsorIds = new Set<number>();

		// 1. Bill Submission (議案提出)
		// 1a. Bill Sponsors (+10)
		const sponsors = cache.billSponsorsByBillId.get(bill.id) || [];

		for (const sponsor of sponsors) {
			sponsorIds.add(sponsor.memberId);
			const memberScore = memberScoresMap.get(sponsor.memberId);
			if (memberScore) {
				memberScore.score += 10;
				memberScore.breakdown.push('Bill Sponsor: +10');
			}
		}

		// 1b. Sponsoring Group (but exclude sponsors to avoid double counting)
		const sponsorGroups = cache.billSponsorGroupsByBillId.get(bill.id) || [];

		if (sponsorGroups.length > 0) {
			// Group is specified - use the group directly (chamber is already part of the group)
			for (const sponsorGroup of sponsorGroups) {
				if (bill.submissionDate) {
					const groupMembers = getMembersInGroupOnDate(
						sponsorGroup.groupId,
						bill.submissionDate,
						cache
					);
					for (const memberId of groupMembers) {
						// Skip if already a sponsor
						if (sponsorIds.has(memberId)) continue;

						const memberScore = memberScoresMap.get(memberId);
						if (memberScore) {
							memberScore.score += 2;
							memberScore.breakdown.push('Sponsoring Group Member: +2');
						}
					}
				}
			}
		} else {
			// No group specified, use sponsor's group (find any group they belong to)
			if (bill.submissionDate) {
				const addedMembers = new Set<number>(); // Avoid double adding
				for (const sponsor of sponsors) {
					// Pass null for chamber to find the sponsor's group in any chamber
					const groupId = getMemberGroupOnDate(sponsor.memberId, bill.submissionDate, null, cache);
					if (groupId) {
						const groupMembers = getMembersInGroupOnDate(groupId, bill.submissionDate, cache);
						for (const memberId of groupMembers) {
							// Skip if already a sponsor or already added
							if (sponsorIds.has(memberId) || addedMembers.has(memberId)) continue;
							addedMembers.add(memberId);

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
		const supporters = cache.billSupportersByBillId.get(bill.id) || [];

		for (const supporter of supporters) {
			const memberScore = memberScoresMap.get(supporter.memberId);
			if (memberScore) {
				memberScore.score += 5;
				memberScore.breakdown.push('Bill Supporter: +5');
			}
		}

		// 2. Bill Voting (議案採決)
		const votes = cache.billVotesByBillId.get(bill.id) || [];

		for (const vote of votes) {
			if (!vote.votingDate) continue;

			if (vote.chamber === '衆議院') {
				// House of Representatives
				const groupVotes = cache.billVotesResultGroupsByVoteId.get(vote.id) || [];

				for (const groupVote of groupVotes) {
					const groupMembers = getMembersInGroupOnDate(groupVote.groupId, vote.votingDate, cache);
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
				const memberVotes = cache.billVotesResultMembersByVoteId.get(vote.id) || [];

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
		// Pre-load all data for efficiency
		const cache = await loadAllData();

		const legislationScores = await calculateLegislationScores(cache);

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
