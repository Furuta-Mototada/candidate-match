import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import {
	member,
	memberParty,
	party,
	memberGroup,
	group,
	billVotes,
	billVotesResultMember,
	bill
} from '$lib/server/db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { getMemberBillScores } from '$lib/server/legislation-score-index.js';

export const GET: RequestHandler = async ({ url }) => {
	const memberIdParam = url.searchParams.get('memberId');
	const billIdsParam = url.searchParams.get('billIds');

	if (!memberIdParam) {
		return json({ error: 'memberId is required' }, { status: 400 });
	}

	const memberId = parseInt(memberIdParam, 10);
	if (isNaN(memberId)) {
		return json({ error: 'Invalid memberId' }, { status: 400 });
	}

	// Parse bill IDs if provided
	const billIds: number[] = billIdsParam
		? billIdsParam
				.split(',')
				.map((id) => parseInt(id, 10))
				.filter((id) => !isNaN(id))
		: [];

	try {
		// 1. Get member basic info
		const memberRow = await db.query.member.findFirst({
			where: eq(member.id, memberId)
		});

		if (!memberRow) {
			return json({ error: 'Member not found' }, { status: 404 });
		}

		// 2. Get party history
		const partyHistory = await db
			.select({
				partyName: party.name,
				chamber: memberParty.chamber,
				startDate: memberParty.startDate,
				endDate: memberParty.endDate
			})
			.from(memberParty)
			.innerJoin(party, eq(memberParty.partyId, party.id))
			.where(eq(memberParty.memberId, memberId))
			.orderBy(memberParty.startDate);

		// 3. Get group (会派) history
		const groupHistory = await db
			.select({
				groupName: group.name,
				chamber: group.chamber,
				startDate: memberGroup.startDate,
				endDate: memberGroup.endDate
			})
			.from(memberGroup)
			.innerJoin(group, eq(memberGroup.groupId, group.id))
			.where(eq(memberGroup.memberId, memberId))
			.orderBy(memberGroup.startDate);

		// 4. Get bill score records for all requested bills
		let billScoreRecords: Array<{
			billId: number;
			billTitle: string | null;
			billType: string | null;
			submissionSession: number | null;
			billNumber: number | null;
			normalizedScore: number | null;
			hasVoteRecord: boolean;
			approved: boolean | null;
		}> = [];

		if (billIds.length > 0) {
			// Get formal vote records (from push-button voting)
			const voteRows = await db
				.select({
					billId: billVotes.billId,
					approved: billVotesResultMember.approved
				})
				.from(billVotesResultMember)
				.innerJoin(billVotes, eq(billVotesResultMember.billVotesId, billVotes.id))
				.where(
					and(eq(billVotesResultMember.memberId, memberId), inArray(billVotes.billId, billIds))
				);

			const voteMap = new Map<number, boolean>();
			for (const row of voteRows) {
				voteMap.set(row.billId, row.approved);
			}

			// Get bill titles and metadata
			const billRows = await db
				.select({
					id: bill.id,
					title: bill.title,
					type: bill.type,
					submissionSession: bill.submissionSession,
					number: bill.number
				})
				.from(bill)
				.where(inArray(bill.id, billIds));

			const billInfoMap = new Map<
				number,
				{ title: string | null; type: string; submissionSession: number; number: number }
			>();
			for (const row of billRows) {
				billInfoMap.set(row.id, {
					title: row.title,
					type: row.type,
					submissionSession: row.submissionSession,
					number: row.number
				});
			}

			// Get normalized legislation scores for ALL requested bills
			const scoreMap = getMemberBillScores(memberId, billIds);

			// Build record for every requested bill
			billScoreRecords = billIds.map((billId) => {
				const info = billInfoMap.get(billId);
				return {
					billId,
					billTitle: info?.title ?? null,
					billType: info?.type ?? null,
					submissionSession: info?.submissionSession ?? null,
					billNumber: info?.number ?? null,
					normalizedScore: scoreMap.get(billId) ?? null,
					hasVoteRecord: voteMap.has(billId),
					approved: voteMap.get(billId) ?? null
				};
			});
		}

		return json({
			memberId: memberRow.id,
			names: memberRow.names,
			nameReading: memberRow.nameReading,
			partyHistory,
			groupHistory,
			billScoreRecords
		});
	} catch (e) {
		console.error('Failed to fetch member detail:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
