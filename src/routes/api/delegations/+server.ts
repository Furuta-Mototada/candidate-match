import { json } from '@sveltejs/kit';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { RequestHandler } from './$types.js';
import {
	getDelegationChainDownstream,
	getDelegationChainUpstream,
	checkFriendship,
	detectDelegationCycle
} from '$lib/server/delegation-helpers';

/**
 * GET /api/delegations?action=incoming|outgoing|for-bill&billId=N
 *
 * - incoming: delegations where the current user is the delegate (pending ones they need to act on)
 * - outgoing: delegations the current user has made
 * - for-bill: check if user has an active delegation for a specific bill
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const action = url.searchParams.get('action') ?? 'outgoing';
	const userId = locals.user.id;

	if (action === 'incoming') {
		// Delegations where I am the delegate and status is pending
		const incoming = await db
			.select({
				id: table.voteDelegation.id,
				delegatorId: table.voteDelegation.delegatorId,
				delegatorUsername: table.user.username,
				billId: table.voteDelegation.billId,
				billTitle: table.bill.title,
				status: table.voteDelegation.status,
				createdAt: table.voteDelegation.createdAt
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegatorId, table.user.id))
			.innerJoin(table.bill, eq(table.voteDelegation.billId, table.bill.id))
			.where(
				and(eq(table.voteDelegation.delegateId, userId), eq(table.voteDelegation.status, 'pending'))
			)
			.orderBy(table.voteDelegation.createdAt);

		return json({ success: true, delegations: incoming });
	}

	if (action === 'outgoing') {
		// All delegations I've made (any status)
		const outgoing = await db
			.select({
				id: table.voteDelegation.id,
				delegateId: table.voteDelegation.delegateId,
				delegateUsername: table.user.username,
				billId: table.voteDelegation.billId,
				billTitle: table.bill.title,
				status: table.voteDelegation.status,
				createdAt: table.voteDelegation.createdAt,
				updatedAt: table.voteDelegation.updatedAt
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegateId, table.user.id))
			.innerJoin(table.bill, eq(table.voteDelegation.billId, table.bill.id))
			.where(eq(table.voteDelegation.delegatorId, userId))
			.orderBy(table.voteDelegation.createdAt);

		return json({ success: true, delegations: outgoing });
	}

	if (action === 'for-bill') {
		const billId = url.searchParams.get('billId');
		if (!billId) {
			return json({ error: 'billId is required' }, { status: 400 });
		}

		const [delegation] = await db
			.select({
				id: table.voteDelegation.id,
				delegateId: table.voteDelegation.delegateId,
				delegateUsername: table.user.username,
				status: table.voteDelegation.status
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegateId, table.user.id))
			.where(
				and(
					eq(table.voteDelegation.delegatorId, userId),
					eq(table.voteDelegation.billId, parseInt(billId))
				)
			);

		return json({ success: true, delegation: delegation || null });
	}

	if (action === 'all') {
		// Get both incoming and outgoing for the management page
		const incomingRaw = await db
			.select({
				id: table.voteDelegation.id,
				delegatorId: table.voteDelegation.delegatorId,
				delegatorUsername: table.user.username,
				billId: table.voteDelegation.billId,
				billTitle: table.bill.title,
				billType: table.bill.type,
				billSubmissionSession: table.bill.submissionSession,
				billNumber: table.bill.number,
				status: table.voteDelegation.status,
				createdAt: table.voteDelegation.createdAt,
				updatedAt: table.voteDelegation.updatedAt
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegatorId, table.user.id))
			.innerJoin(table.bill, eq(table.voteDelegation.billId, table.bill.id))
			.where(eq(table.voteDelegation.delegateId, userId))
			.orderBy(table.voteDelegation.createdAt);

		// For each incoming delegation, check if the current user already voted on that bill
		const incomingBillIds = incomingRaw.map((d: { billId: number }) => d.billId);
		const myVotesMap = new Map<number, number>();
		if (incomingBillIds.length > 0) {
			const myVotes = await db
				.select({ billId: table.userBillAnswer.billId, score: table.userBillAnswer.score })
				.from(table.userBillAnswer)
				.where(
					and(
						eq(table.userBillAnswer.userId, userId),
						inArray(table.userBillAnswer.billId, incomingBillIds)
					)
				);
			for (const v of myVotes) {
				myVotesMap.set(v.billId, v.score);
			}
		}

		const incoming = incomingRaw.map((d: (typeof incomingRaw)[number]) => ({
			...d,
			myExistingScore: myVotesMap.get(d.billId) ?? null
		}));

		const outgoingRaw = await db
			.select({
				id: table.voteDelegation.id,
				delegateId: table.voteDelegation.delegateId,
				delegateUsername: table.user.username,
				billId: table.voteDelegation.billId,
				billTitle: table.bill.title,
				billType: table.bill.type,
				billSubmissionSession: table.bill.submissionSession,
				billNumber: table.bill.number,
				status: table.voteDelegation.status,
				createdAt: table.voteDelegation.createdAt,
				updatedAt: table.voteDelegation.updatedAt
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegateId, table.user.id))
			.innerJoin(table.bill, eq(table.voteDelegation.billId, table.bill.id))
			.where(eq(table.voteDelegation.delegatorId, userId))
			.orderBy(table.voteDelegation.createdAt);

		// Build delegation chain info for outgoing delegations
		// Also look up the current user's vote for each bill (this IS the delegated vote result)
		const outgoingBillIds = outgoingRaw.map((d: { billId: number }) => d.billId);
		const myOutgoingVotesMap = new Map<number, number>();
		if (outgoingBillIds.length > 0) {
			const myOutVotes = await db
				.select({ billId: table.userBillAnswer.billId, score: table.userBillAnswer.score })
				.from(table.userBillAnswer)
				.where(
					and(
						eq(table.userBillAnswer.userId, userId),
						inArray(table.userBillAnswer.billId, outgoingBillIds)
					)
				);
			for (const v of myOutVotes) {
				myOutgoingVotesMap.set(v.billId, v.score);
			}
		}

		const outgoing = await Promise.all(
			outgoingRaw.map(async (d: (typeof outgoingRaw)[number]) => {
				const chain = await getDelegationChainDownstream(d.delegateId, d.billId);
				return { ...d, chain, myVoteScore: myOutgoingVotesMap.get(d.billId) ?? null };
			})
		);

		// Build upstream chain info for incoming delegations
		const incomingWithChain = await Promise.all(
			incoming.map(async (d: (typeof incoming)[number]) => {
				const chain = await getDelegationChainUpstream(d.delegatorId, d.billId);
				return { ...d, upstreamChain: chain };
			})
		);

		return json({ success: true, incoming: incomingWithChain, outgoing });
	}

	return json({ error: '無効なアクションです' }, { status: 400 });
};

/**
 * POST /api/delegations
 *
 * Actions:
 * - delegate: Create a new delegation
 * - accept: Accept and vote on a delegation
 * - reject: Reject a delegation
 * - retract: Retract (cancel) your delegation
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const body = await request.json();
	const { action } = body;
	const userId = locals.user.id;

	// ── Create a delegation ──
	if (action === 'delegate') {
		const { delegateId, billId } = body;

		if (!delegateId || !billId) {
			return json({ error: '委任先ユーザーと法案IDが必要です' }, { status: 400 });
		}

		if (delegateId === userId) {
			return json({ error: '自分に委任はできません' }, { status: 400 });
		}

		// Verify they are friends
		const isFriend = await checkFriendship(userId, delegateId);
		if (!isFriend) {
			return json({ error: 'フレンドのみに委任できます' }, { status: 400 });
		}

		// Check for delegation cycles
		const hasCycle = await detectDelegationCycle(userId, delegateId, billId);
		if (hasCycle) {
			return json(
				{ error: '委任の循環が検出されました。この委任先には委任できません。' },
				{ status: 400 }
			);
		}

		// Check if user already has a delegation for this bill
		const [existing] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(eq(table.voteDelegation.delegatorId, userId), eq(table.voteDelegation.billId, billId))
			);

		if (existing) {
			if (existing.status === 'pending' || existing.status === 'accepted' || existing.status === 'redelegated') {
				return json({ error: 'この法案には既にアクティブな委任があります。先に取り消してから再委任してください。' }, { status: 400 });
			}
			// If rejected or voted — allow re-delegation by updating
			await db
				.update(table.voteDelegation)
				.set({
					delegateId,
					status: 'pending',
					updatedAt: new Date()
				})
				.where(eq(table.voteDelegation.id, existing.id));

			// Auto-forward all pending incoming delegations for this bill
			await db
				.update(table.voteDelegation)
				.set({ status: 'redelegated', updatedAt: new Date() })
				.where(
					and(
						eq(table.voteDelegation.delegateId, userId),
						eq(table.voteDelegation.billId, billId),
						eq(table.voteDelegation.status, 'pending')
					)
				);

			// Remove user's own vote — the delegate will decide
			await db
				.delete(table.userBillAnswer)
				.where(
					and(eq(table.userBillAnswer.userId, userId), eq(table.userBillAnswer.billId, billId))
				);

			return json({ success: true, message: '委任を送信しました' });
		}

		await db.insert(table.voteDelegation).values({
			delegatorId: userId,
			delegateId,
			billId,
			status: 'pending'
		});

		// Auto-forward all pending incoming delegations for this bill
		await db
			.update(table.voteDelegation)
			.set({ status: 'redelegated', updatedAt: new Date() })
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, billId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		// Remove user's own vote — the delegate will decide
		await db
			.delete(table.userBillAnswer)
			.where(and(eq(table.userBillAnswer.userId, userId), eq(table.userBillAnswer.billId, billId)));

		return json({ success: true, message: '委任を送信しました' });
	}

	// ── Accept a delegation and cast a vote ──
	// This applies to ALL pending incoming delegations for the same bill
	if (action === 'accept') {
		const { delegationId, score: providedScore } = body;

		if (!delegationId) {
			return json({ error: '委任IDが必要です' }, { status: 400 });
		}

		const [delegation] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.id, delegationId),
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		if (!delegation) {
			return json({ error: '委任が見つかりません' }, { status: 404 });
		}

		// Check if delegate already voted for this bill themselves
		const [existingAnswer] = await db
			.select()
			.from(table.userBillAnswer)
			.where(
				and(
					eq(table.userBillAnswer.userId, userId),
					eq(table.userBillAnswer.billId, delegation.billId)
				)
			);

		// If delegate already voted, use their existing vote; otherwise require a score
		let score: number;
		if (existingAnswer) {
			score = existingAnswer.score;
		} else if (providedScore !== undefined && [1, 0, -1].includes(providedScore)) {
			score = providedScore;

			// Store the delegate's own vote in user_bill_answer (single source of truth)
			await db
				.insert(table.userBillAnswer)
				.values({
					userId,
					billId: delegation.billId,
					score
				})
				.onConflictDoUpdate({
					target: [table.userBillAnswer.userId, table.userBillAnswer.billId],
					set: {
						score,
						updatedAt: sql`now()`
					}
				});
		} else {
			return json(
				{ error: 'この法案にまだ投票していないため、投票スコアが必要です' },
				{ status: 400 }
			);
		}

		// Find ALL pending incoming delegations for this bill (including the specified one)
		const allPending = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		// Mark ALL pending incoming delegations as voted
		for (const d of allPending) {
			await db
				.update(table.voteDelegation)
				.set({ status: 'voted', updatedAt: new Date() })
				.where(eq(table.voteDelegation.id, d.id));
		}

		return json({
			success: true,
			message: existingAnswer
				? `あなたの既存の投票（${score === 1 ? '賛成' : score === -1 ? '反対' : 'わからない'}）で委任を承認しました`
				: '委任を承認し、投票しました'
		});
	}

	// ── Redelegate: pass a received delegation to another friend ──
	// Instead of updating A→B, we mark A→B as 'redelegated' and create a new B→C delegation
	if (action === 'redelegate') {
		const { delegationId, delegateId: newDelegateId } = body;

		if (!delegationId || !newDelegateId) {
			return json({ error: '委任IDと再委任先ユーザーIDが必要です' }, { status: 400 });
		}

		if (newDelegateId === userId) {
			return json({ error: '自分に委任はできません' }, { status: 400 });
		}

		// Find the delegation being redelegated (I am the delegate)
		const [delegation] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.id, delegationId),
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		if (!delegation) {
			return json({ error: '委任が見つかりません' }, { status: 404 });
		}

		// Verify friendship with the new delegate
		const isFriend = await checkFriendship(userId, newDelegateId);
		if (!isFriend) {
			return json({ error: 'フレンドのみに委任できます' }, { status: 400 });
		}

		// Check for cycles: userId -> newDelegateId for this bill
		const hasCycle = await detectDelegationCycle(userId, newDelegateId, delegation.billId);
		if (hasCycle) {
			return json(
				{ error: '委任の循環が検出されました。この委任先には委任できません。' },
				{ status: 400 }
			);
		}

		// Mark ALL pending incoming delegations for this bill as 'redelegated'
		await db
			.update(table.voteDelegation)
			.set({ status: 'redelegated', updatedAt: new Date() })
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		// Check if I already have an outgoing delegation for this bill
		const [existingOutgoing] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegatorId, userId),
					eq(table.voteDelegation.billId, delegation.billId)
				)
			);

		if (existingOutgoing) {
			// Update existing outgoing delegation
			await db
				.update(table.voteDelegation)
				.set({
					delegateId: newDelegateId,
					status: 'pending',
					updatedAt: new Date()
				})
				.where(eq(table.voteDelegation.id, existingOutgoing.id));
		} else {
			// Create a new delegation: me → newDelegate
			await db.insert(table.voteDelegation).values({
				delegatorId: userId,
				delegateId: newDelegateId,
				billId: delegation.billId,
				status: 'pending'
			});
		}

		// Remove user's own vote — the new delegate will decide
		await db
			.delete(table.userBillAnswer)
			.where(
				and(
					eq(table.userBillAnswer.userId, userId),
					eq(table.userBillAnswer.billId, delegation.billId)
				)
			);

		return json({ success: true, message: '委任を転送しました' });
	}

	// ── Reject ALL pending incoming delegations for a bill ──
	if (action === 'reject') {
		const { delegationId } = body;

		if (!delegationId) {
			return json({ error: '委任IDが必要です' }, { status: 400 });
		}

		const [delegation] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.id, delegationId),
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		if (!delegation) {
			return json({ error: '委任が見つかりません' }, { status: 404 });
		}

		// Reject ALL pending incoming delegations for the same bill
		await db
			.update(table.voteDelegation)
			.set({ status: 'rejected', updatedAt: new Date() })
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

		return json({ success: true, message: '委任を拒否しました' });
	}

	// ── Retract (cancel) a delegation ──
	if (action === 'retract') {
		const { delegationId } = body;

		if (!delegationId) {
			return json({ error: '委任IDが必要です' }, { status: 400 });
		}

		const [delegation] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(eq(table.voteDelegation.id, delegationId), eq(table.voteDelegation.delegatorId, userId))
			);

		if (!delegation) {
			return json({ error: '委任が見つかりません' }, { status: 404 });
		}

		await db.delete(table.voteDelegation).where(eq(table.voteDelegation.id, delegationId));

		// Restore ALL upstream 'redelegated' delegations back to 'pending'
		await db
			.update(table.voteDelegation)
			.set({ status: 'pending', updatedAt: new Date() })
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'redelegated')
				)
			);

		return json({ success: true, message: '委任を取り消しました' });
	}

	// ── Undo votes: revert ALL voted incoming delegations for a bill back to pending ──
	if (action === 'undo-vote') {
		const { delegationId } = body;

		if (!delegationId) {
			return json({ error: '委任IDが必要です' }, { status: 400 });
		}

		const [delegation] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.id, delegationId),
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.status, 'voted')
				)
			);

		if (!delegation) {
			return json({ error: '委任が見つかりません' }, { status: 404 });
		}

		// Revert ALL to pending
		await db
			.update(table.voteDelegation)
			.set({ status: 'pending', updatedAt: new Date() })
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'voted')
				)
			);

		return json({ success: true, message: '投票を取り消し、保留に戻しました' });
	}

	// ── Undo rejections: revert ALL rejected incoming delegations for a bill back to pending ──
	if (action === 'undo-reject') {
		const { delegationId } = body;

		if (!delegationId) {
			return json({ error: '委任IDが必要です' }, { status: 400 });
		}

		const [delegation] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.id, delegationId),
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.status, 'rejected')
				)
			);

		if (!delegation) {
			return json({ error: '委任が見つかりません' }, { status: 404 });
		}

		// Revert ALL rejected incoming delegations for the same bill
		await db
			.update(table.voteDelegation)
			.set({ status: 'pending', updatedAt: new Date() })
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'rejected')
				)
			);

		return json({ success: true, message: '拒否を取り消し、保留に戻しました' });
	}

	return json({ error: '無効なアクションです' }, { status: 400 });
};
