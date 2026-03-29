import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { bill, userBillAnswer, voteDelegation, user } from '$lib/server/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { answerToScore } from '$lib/server/matching.js';

/**
 * GET /api/bills/all
 *
 * Returns all bills with the current user's answer status and delegation status.
 * Each bill includes:
 * - Bill metadata (id, type, session, number, title, result)
 * - User's answer score (if voted)
 * - Outgoing delegation info (if delegated to someone)
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const userId = locals.user.id;

	// Fetch all bills with left-joined user answer and outgoing delegation
	const rows = await db
		.select({
			id: bill.id,
			type: bill.type,
			submissionSession: bill.submissionSession,
			number: bill.number,
			title: bill.title,
			result: bill.result,
			submissionDate: bill.submissionDate,
			// User's own answer (null if not answered)
			answerValue: userBillAnswer.answer,
			// Outgoing delegation fields (null if not delegated)
			delegationId: voteDelegation.id,
			delegationStatus: voteDelegation.status,
			delegateId: voteDelegation.delegateId
		})
		.from(bill)
		.leftJoin(
			userBillAnswer,
			and(eq(userBillAnswer.billId, bill.id), eq(userBillAnswer.userId, userId))
		)
		.leftJoin(
			voteDelegation,
			and(eq(voteDelegation.billId, bill.id), eq(voteDelegation.delegatorId, userId))
		)
		.orderBy(sql`${bill.submissionSession} DESC, ${bill.number} ASC`);

	// Collect delegate user IDs for username lookup
	const delegateIds = new Set<string>();
	for (const row of rows) {
		if (row.delegateId) delegateIds.add(row.delegateId);
	}

	// Fetch delegate usernames
	const delegateUsernameMap = new Map<string, string>();
	if (delegateIds.size > 0) {
		const delegateUsers = await db
			.select({ id: user.id, username: user.username })
			.from(user)
			.where(
				sql`${user.id} IN (${sql.join(
					[...delegateIds].map((id) => sql`${id}`),
					sql`, `
				)})`
			);
		for (const u of delegateUsers) {
			delegateUsernameMap.set(u.id, u.username);
		}
	}

	// Fetch bill IDs where the user has incoming delegations (is the delegate)
	const incomingDelegationRows = await db
		.select({ billId: voteDelegation.billId })
		.from(voteDelegation)
		.where(eq(voteDelegation.delegateId, userId));
	const incomingDelegationBillIds = new Set(incomingDelegationRows.map((r) => r.billId));

	const bills = rows.map((row) => ({
		id: row.id,
		type: row.type,
		submissionSession: row.submissionSession,
		number: row.number,
		title: row.title || '',
		result: row.result,
		submissionDate: row.submissionDate,
		answerScore:
			row.answerValue && row.answerValue !== 'delegated' ? answerToScore(row.answerValue) : null,
		delegation: row.delegationId
			? {
					id: row.delegationId,
					status: row.delegationStatus,
					delegateUsername: delegateUsernameMap.get(row.delegateId!) || ''
				}
			: null,
		hasIncomingDelegation: incomingDelegationBillIds.has(row.id)
	}));

	return json({ success: true, bills });
};
