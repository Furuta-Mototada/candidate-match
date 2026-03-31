import { db } from './db/index.js';
import { memberParty, party, bill, congressSession, clusterVectorResults } from './db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import type { GlobalPartyScore, PartyScores } from '$lib/types/index.js';

interface ClusterMatchInput {
	clusterLabel: number;
	importance: number;
	matches: Array<{ memberId: number; name: string; group: string | null; similarity: number }>;
}

/**
 * Calculate party scores using both modes (current roster + historical).
 *
 * Current roster: party = average of currently affiliated MPs.
 * Historical: party = weighted average based on temporal overlap of MP tenure and bill dates.
 */
export async function calculatePartyScores(
	clusterResults: ClusterMatchInput[],
	vectorGroupKey?: string | null
): Promise<PartyScores> {
	if (clusterResults.length === 0) {
		return { current: [], historical: [] };
	}

	// Collect all member IDs from cluster results
	const allMemberIds = new Set<number>();
	for (const cr of clusterResults) {
		for (const m of cr.matches) {
			allMemberIds.add(m.memberId);
		}
	}
	const memberIdArr = Array.from(allMemberIds);
	if (memberIdArr.length === 0) {
		return { current: [], historical: [] };
	}

	// Load all party memberships for these members
	const allMemberships = await db
		.select({
			memberId: memberParty.memberId,
			partyId: memberParty.partyId,
			partyName: party.name,
			startDate: memberParty.startDate,
			endDate: memberParty.endDate
		})
		.from(memberParty)
		.innerJoin(party, eq(memberParty.partyId, party.id))
		.where(inArray(memberParty.memberId, memberIdArr));

	// ── Option A: Current Roster ──
	const currentScores = calculateCurrentRoster(clusterResults, allMemberships);

	// ── Option B: Historical Actions ──
	let historicalScores: GlobalPartyScore[] = [];
	if (vectorGroupKey) {
		historicalScores = await calculateHistorical(clusterResults, allMemberships, vectorGroupKey);
	}

	return { current: currentScores, historical: historicalScores };
}

// ============================================================================
// Option A: Current Roster
// ============================================================================

function calculateCurrentRoster(
	clusterResults: ClusterMatchInput[],
	allMemberships: Array<{
		memberId: number;
		partyId: number;
		partyName: string;
		startDate: string | null;
		endDate: string | null;
	}>
): GlobalPartyScore[] {
	// Find current party for each member (endDate IS NULL)
	const memberCurrentParty = new Map<number, { partyId: number; partyName: string }>();
	for (const m of allMemberships) {
		if (m.endDate === null) {
			memberCurrentParty.set(m.memberId, { partyId: m.partyId, partyName: m.partyName });
		}
	}

	// For each party, for each cluster, collect member similarities and average them
	// Structure: partyId -> { partyName, clusterScores: { clusterLabel -> { sum, count } }, memberIds }
	const partyAgg = new Map<
		number,
		{
			partyName: string;
			clusterAgg: Map<number, { sum: number; count: number }>;
			memberIds: Set<number>;
		}
	>();

	for (const cr of clusterResults) {
		for (const match of cr.matches) {
			const partyInfo = memberCurrentParty.get(match.memberId);
			if (!partyInfo) continue; // Skip members not currently in any party

			if (!partyAgg.has(partyInfo.partyId)) {
				partyAgg.set(partyInfo.partyId, {
					partyName: partyInfo.partyName,
					clusterAgg: new Map(),
					memberIds: new Set()
				});
			}
			const agg = partyAgg.get(partyInfo.partyId)!;
			agg.memberIds.add(match.memberId);

			if (!agg.clusterAgg.has(cr.clusterLabel)) {
				agg.clusterAgg.set(cr.clusterLabel, { sum: 0, count: 0 });
			}
			const ca = agg.clusterAgg.get(cr.clusterLabel)!;
			ca.sum += match.similarity;
			ca.count += 1;
		}
	}

	return computeGlobalPartyScores(clusterResults, partyAgg);
}

// ============================================================================
// Option B: Historical Actions
// ============================================================================

async function calculateHistorical(
	clusterResults: ClusterMatchInput[],
	allMemberships: Array<{
		memberId: number;
		partyId: number;
		partyName: string;
		startDate: string | null;
		endDate: string | null;
	}>,
	vectorGroupKey: string
): Promise<GlobalPartyScore[]> {
	// Parse vectorGroupKey to get cluster vector data
	const separatorIndex = vectorGroupKey.lastIndexOf('|');
	if (separatorIndex === -1) return [];
	const vectorName = vectorGroupKey.substring(0, separatorIndex);
	const clusterId = parseInt(vectorGroupKey.substring(separatorIndex + 1));
	if (isNaN(clusterId)) return [];

	// Load cluster vector results to get bill IDs per cluster label
	const savedVectors = await db
		.select({
			clusterLabel: clusterVectorResults.clusterLabel,
			billIds: clusterVectorResults.billIds
		})
		.from(clusterVectorResults)
		.where(
			and(eq(clusterVectorResults.clusterId, clusterId), eq(clusterVectorResults.name, vectorName))
		);

	const clusterBillIds = new Map<number, number[]>();
	const allBillIds = new Set<number>();
	for (const sv of savedVectors) {
		const ids: number[] = JSON.parse(sv.billIds);
		clusterBillIds.set(sv.clusterLabel, ids);
		for (const id of ids) allBillIds.add(id);
	}

	if (allBillIds.size === 0) return [];

	// Load bill dates (both submission and result dates)
	const billDates = await db
		.select({
			id: bill.id,
			submissionDate: bill.submissionDate,
			resultDate: bill.resultDate,
			submissionSession: bill.submissionSession
		})
		.from(bill)
		.where(inArray(bill.id, Array.from(allBillIds)));

	// Load session dates as fallback
	const sessionNumbers = new Set(billDates.map((b) => b.submissionSession));
	const sessions = await db
		.select({
			sessionNumber: congressSession.sessionNumber,
			startDate: congressSession.startDate
		})
		.from(congressSession)
		.where(inArray(congressSession.sessionNumber, Array.from(sessionNumbers)));

	const sessionStartDates = new Map<number, string>();
	for (const s of sessions) {
		sessionStartDates.set(s.sessionNumber, s.startDate);
	}

	// Build bill date range map: billId -> { start, end }
	// A bill's active period spans from submissionDate to resultDate.
	// If resultDate is missing, we use submissionDate as a single point.
	// This matters because a bill may be submitted under one party tenure
	// but voted on under another — both parties should get credit.
	const billDateRangeMap = new Map<number, { start: string; end: string }>();
	for (const b of billDates) {
		const start = b.submissionDate ?? sessionStartDates.get(b.submissionSession) ?? null;
		if (start) {
			const end = b.resultDate ?? start;
			billDateRangeMap.set(b.id, { start, end });
		}
	}

	// Build membership lookup: memberId -> array of { partyId, partyName, startDate, endDate }
	const membershipLookup = new Map<
		number,
		Array<{ partyId: number; partyName: string; startDate: string | null; endDate: string | null }>
	>();
	for (const m of allMemberships) {
		if (!membershipLookup.has(m.memberId)) {
			membershipLookup.set(m.memberId, []);
		}
		membershipLookup.get(m.memberId)!.push(m);
	}

	// For each cluster, for each member, compute overlap fraction per party
	// partyId -> { partyName, clusterAgg: clusterLabel -> { weightedSum, totalWeight }, memberIds }
	const partyAgg = new Map<
		number,
		{
			partyName: string;
			clusterAgg: Map<number, { weightedSum: number; totalWeight: number }>;
			memberIds: Set<number>;
		}
	>();

	for (const cr of clusterResults) {
		const billIds = clusterBillIds.get(cr.clusterLabel);
		if (!billIds || billIds.length === 0) continue;

		for (const match of cr.matches) {
			const memberships = membershipLookup.get(match.memberId);
			if (!memberships || memberships.length === 0) continue;

			// For each bill in this cluster, determine which party the member was in.
			// A bill counts toward a party if the member's tenure in that party
			// overlaps with the bill's active period (submission → result).
			for (const membership of memberships) {
				let billsInTenure = 0;
				for (const bId of billIds) {
					const bRange = billDateRangeMap.get(bId);
					if (!bRange) continue;
					if (
						doPeriodsOverlap(bRange.start, bRange.end, membership.startDate, membership.endDate)
					) {
						billsInTenure++;
					}
				}

				if (billsInTenure === 0) continue;

				const overlapFraction = billsInTenure / billIds.length;

				if (!partyAgg.has(membership.partyId)) {
					partyAgg.set(membership.partyId, {
						partyName: membership.partyName,
						clusterAgg: new Map(),
						memberIds: new Set()
					});
				}
				const agg = partyAgg.get(membership.partyId)!;
				agg.memberIds.add(match.memberId);

				if (!agg.clusterAgg.has(cr.clusterLabel)) {
					agg.clusterAgg.set(cr.clusterLabel, { weightedSum: 0, totalWeight: 0 });
				}
				const ca = agg.clusterAgg.get(cr.clusterLabel)!;
				ca.weightedSum += match.similarity * overlapFraction;
				ca.totalWeight += overlapFraction;
			}
		}
	}

	// Compute global scores with weighted averages
	return computeGlobalPartyScoresWeighted(clusterResults, partyAgg);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if two date periods overlap.
 * Period A: [aStart, aEnd] — the bill's active period (submission → result)
 * Period B: [bStart, bEnd] — the member's tenure in the party
 * Overlap exists if A starts before B ends AND B starts before A ends.
 * null start = beginning of time, null end = present day.
 */
function doPeriodsOverlap(
	aStart: string,
	aEnd: string,
	bStart: string | null,
	bEnd: string | null
): boolean {
	const aS = new Date(aStart);
	const aE = new Date(aEnd);
	// If bStart is null, membership extends to the beginning of time
	// If bEnd is null, membership extends to present (still active)
	if (bEnd) {
		const bE = new Date(bEnd);
		if (aS > bE) return false; // Bill starts after membership ended
	}
	if (bStart) {
		const bS = new Date(bStart);
		if (aE < bS) return false; // Bill ended before membership started
	}
	return true;
}

/**
 * Compute global party scores from simple averages (Option A).
 */
function computeGlobalPartyScores(
	clusterResults: ClusterMatchInput[],
	partyAgg: Map<
		number,
		{
			partyName: string;
			clusterAgg: Map<number, { sum: number; count: number }>;
			memberIds: Set<number>;
		}
	>
): GlobalPartyScore[] {
	const totalWeight = clusterResults.reduce((sum, r) => sum + r.importance, 0);
	if (totalWeight === 0) return [];

	const scores: GlobalPartyScore[] = [];

	for (const [partyId, agg] of partyAgg) {
		const clusterScores: Record<number, number> = {};
		let globalScore = 0;

		for (const cr of clusterResults) {
			const ca = agg.clusterAgg.get(cr.clusterLabel);
			if (ca && ca.count > 0) {
				const avg = ca.sum / ca.count;
				clusterScores[cr.clusterLabel] = avg;
				globalScore += (cr.importance / totalWeight) * avg;
			} else {
				clusterScores[cr.clusterLabel] = 0;
			}
		}

		scores.push({
			partyId,
			partyName: agg.partyName,
			globalScore,
			clusterScores,
			memberCount: agg.memberIds.size
		});
	}

	return scores.sort((a, b) => b.globalScore - a.globalScore);
}

/**
 * Compute global party scores from overlap-weighted averages (Option B).
 */
function computeGlobalPartyScoresWeighted(
	clusterResults: ClusterMatchInput[],
	partyAgg: Map<
		number,
		{
			partyName: string;
			clusterAgg: Map<number, { weightedSum: number; totalWeight: number }>;
			memberIds: Set<number>;
		}
	>
): GlobalPartyScore[] {
	const totalImportance = clusterResults.reduce((sum, r) => sum + r.importance, 0);
	if (totalImportance === 0) return [];

	const scores: GlobalPartyScore[] = [];

	for (const [partyId, agg] of partyAgg) {
		const clusterScores: Record<number, number> = {};
		let globalScore = 0;

		for (const cr of clusterResults) {
			const ca = agg.clusterAgg.get(cr.clusterLabel);
			if (ca && ca.totalWeight > 0) {
				const weightedAvg = ca.weightedSum / ca.totalWeight;
				clusterScores[cr.clusterLabel] = weightedAvg;
				globalScore += (cr.importance / totalImportance) * weightedAvg;
			} else {
				clusterScores[cr.clusterLabel] = 0;
			}
		}

		scores.push({
			partyId,
			partyName: agg.partyName,
			globalScore,
			clusterScores,
			memberCount: agg.memberIds.size
		});
	}

	return scores.sort((a, b) => b.globalScore - a.globalScore);
}
