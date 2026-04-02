import { json } from '@sveltejs/kit';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { RequestHandler } from './$types.js';
import {
	getDelegationChainDownstream,
	getDelegationChainUpstream,
	getDelegationTreeUpstream,
	flattenUpstreamTree,
	countTotalVotes,
	checkFriendship,
	detectDelegationCycle
} from '$lib/server/delegation-helpers';
import { answerToScore, scoreToAnswer } from '$lib/server/matching';
import {
	notifyDelegationReceived,
	notifyDelegationRejected,
	notifyDelegationRedelegated,
	notifyDelegationVoted,
	notifyDelegationRetracted,
	notifyUpstreamDelegatorsVoted
} from '$lib/server/notifications';

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
				delegatorAvatarUrl: table.user.avatarUrl,
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
				delegateAvatarUrl: table.user.avatarUrl,
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
				delegateAvatarUrl: table.user.avatarUrl,
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
		// Admin debug mode: only admins can see full delegation details
		const isAdmin = locals.user.role === 'admin';
		const debugMode = isAdmin && url.searchParams.get('debug') === 'true';

		// Get both incoming and outgoing for the management page
		const incomingRaw = await db
			.select({
				id: table.voteDelegation.id,
				delegatorId: table.voteDelegation.delegatorId,
				delegatorUsername: table.user.username,
				delegatorAvatarUrl: table.user.avatarUrl,
				billId: table.voteDelegation.billId,
				billTitle: table.bill.title,
				billType: table.bill.type,
				billSubmissionSession: table.bill.submissionSession,
				billNumber: table.bill.number,
				status: table.voteDelegation.status,
				voteRationale: table.voteDelegation.voteRationale,
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
		const myVotesMap = new Map<number, number | null>();
		if (incomingBillIds.length > 0) {
			const myVotes = await db
				.select({ billId: table.userBillAnswer.billId, answer: table.userBillAnswer.answer })
				.from(table.userBillAnswer)
				.where(
					and(
						eq(table.userBillAnswer.userId, userId),
						inArray(table.userBillAnswer.billId, incomingBillIds)
					)
				);
			for (const v of myVotes) {
				myVotesMap.set(v.billId, v.answer !== 'delegated' ? answerToScore(v.answer) : null);
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
				delegateAvatarUrl: table.user.avatarUrl,
				billId: table.voteDelegation.billId,
				billTitle: table.bill.title,
				billType: table.bill.type,
				billSubmissionSession: table.bill.submissionSession,
				billNumber: table.bill.number,
				status: table.voteDelegation.status,
				voteRationale: table.voteDelegation.voteRationale,
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
		const myOutgoingVotesMap = new Map<number, number | null>();
		if (outgoingBillIds.length > 0) {
			const myOutVotes = await db
				.select({ billId: table.userBillAnswer.billId, answer: table.userBillAnswer.answer })
				.from(table.userBillAnswer)
				.where(
					and(
						eq(table.userBillAnswer.userId, userId),
						inArray(table.userBillAnswer.billId, outgoingBillIds)
					)
				);
			for (const v of myOutVotes) {
				myOutgoingVotesMap.set(v.billId, v.answer !== 'delegated' ? answerToScore(v.answer) : null);
			}
		}

		if (debugMode) {
			// Admin debug mode: full chain info, upstream paths, delegator identities
			const outgoing = await Promise.all(
				outgoingRaw.map(async (d: (typeof outgoingRaw)[number]) => {
					const chain = await getDelegationChainDownstream(d.delegateId, d.billId);
					const delegateVotes = await countTotalVotes(d.delegateId, d.billId);
					const chainWithVotes = await Promise.all(
						chain.map(async (link) => {
							const [u] = await db
								.select({ id: table.user.id })
								.from(table.user)
								.where(eq(table.user.username, link.username))
								.limit(1);
							const votes = u ? await countTotalVotes(u.id, d.billId) : 1;
							return { ...link, totalVotes: votes };
						})
					);
					return {
						...d,
						chain: chainWithVotes,
						delegateVotes,
						myVoteScore: myOutgoingVotesMap.get(d.billId) ?? null
					};
				})
			);

			const incomingWithChain = await Promise.all(
				incoming.map(async (d: (typeof incoming)[number]) => {
					const tree = await getDelegationTreeUpstream(d.delegatorId, d.billId);
					const upstreamPaths = flattenUpstreamTree(tree);
					const chain = await getDelegationChainUpstream(d.delegatorId, d.billId);
					return { ...d, upstreamChain: chain, upstreamPaths };
				})
			);

			return json({
				success: true,
				incoming: incomingWithChain,
				outgoing,
				isAdmin,
				debugMode: true
			});
		}

		// Normal mode: anonymous incoming, no redelegation chain for outgoing
		// Helper to bucket counts for privacy
		function bucketCount(count: number): string {
			if (count === 0) return '0';
			if (count <= 3) return '1〜3';
			if (count <= 10) return '4〜10';
			if (count <= 30) return '11〜30';
			return '30+';
		}

		// Outgoing: only direct delegate info, no forward chain
		// For 'redelegated' delegations, walk downstream to find terminal info
		async function findDownstreamTerminal(
			delegateId: string,
			billId: number
		): Promise<{
			rationale: string | null;
			terminalStatus: string | null;
			terminalVoteScore: number | null;
		}> {
			const visited = new Set<string>();
			let current = delegateId;
			let lastStatus: string | null = null;
			while (current && !visited.has(current)) {
				visited.add(current);
				const [del] = await db
					.select({
						delegateId: table.voteDelegation.delegateId,
						status: table.voteDelegation.status,
						voteRationale: table.voteDelegation.voteRationale
					})
					.from(table.voteDelegation)
					.where(
						and(
							eq(table.voteDelegation.delegatorId, current),
							eq(table.voteDelegation.billId, billId)
						)
					)
					.limit(1);
				if (!del) {
					// No further delegation - the current person hasn't delegated further
					// Check if they have a direct vote
					const [vote] = await db
						.select({ answer: table.userBillAnswer.answer })
						.from(table.userBillAnswer)
						.where(
							and(eq(table.userBillAnswer.userId, current), eq(table.userBillAnswer.billId, billId))
						)
						.limit(1);
					if (vote && vote.answer !== 'delegated') {
						return {
							rationale: null,
							terminalStatus: lastStatus,
							terminalVoteScore: answerToScore(vote.answer)
						};
					}
					return { rationale: null, terminalStatus: lastStatus, terminalVoteScore: null };
				}
				lastStatus = del.status;
				if (del.status === 'voted') {
					// Find the vote score from the delegate (the person who actually voted)
					const [vote] = await db
						.select({ answer: table.userBillAnswer.answer })
						.from(table.userBillAnswer)
						.where(
							and(
								eq(table.userBillAnswer.userId, del.delegateId),
								eq(table.userBillAnswer.billId, billId)
							)
						)
						.limit(1);
					return {
						rationale: del.voteRationale,
						terminalStatus: 'voted',
						terminalVoteScore:
							vote && vote.answer !== 'delegated' ? answerToScore(vote.answer) : null
					};
				}
				if (del.status !== 'redelegated') {
					return { rationale: null, terminalStatus: del.status, terminalVoteScore: null };
				}
				current = del.delegateId;
			}
			return { rationale: null, terminalStatus: lastStatus, terminalVoteScore: null };
		}

		const outgoing = await Promise.all(
			outgoingRaw.map(async (d: (typeof outgoingRaw)[number]) => {
				let terminalStatus: string | null = null;
				let terminalVoteScore: number | null = null;
				let rationale = d.voteRationale;

				if (d.status === 'redelegated') {
					const terminal = await findDownstreamTerminal(d.delegateId, d.billId);
					terminalStatus = terminal.terminalStatus;
					terminalVoteScore = terminal.terminalVoteScore;
					rationale = terminal.rationale ?? d.voteRationale;
				} else if (d.status === 'voted') {
					// Direct delegate voted — look up their actual vote
					const [delegateVote] = await db
						.select({ answer: table.userBillAnswer.answer })
						.from(table.userBillAnswer)
						.where(
							and(
								eq(table.userBillAnswer.userId, d.delegateId),
								eq(table.userBillAnswer.billId, d.billId)
							)
						)
						.limit(1);
					terminalVoteScore =
						delegateVote && delegateVote.answer !== 'delegated'
							? answerToScore(delegateVote.answer)
							: null;
				}

				return {
					...d,
					chain: [],
					delegateVotes: undefined,
					myVoteScore: myOutgoingVotesMap.get(d.billId) ?? null,
					voteRationale: rationale,
					terminalStatus,
					terminalVoteScore
				};
			})
		);

		// Incoming: anonymize - strip delegator identity, provide bucketed count per bill
		const incomingCountByBill = new Map<number, number>();
		for (const d of incoming) {
			incomingCountByBill.set(d.billId, (incomingCountByBill.get(d.billId) ?? 0) + 1);
		}

		const anonymizedIncoming = incoming.map((d: (typeof incoming)[number]) => ({
			id: d.id,
			delegatorId: '', // stripped for privacy
			delegatorUsername: '', // stripped for privacy
			delegatorAvatarUrl: null,
			billId: d.billId,
			billTitle: d.billTitle,
			billType: d.billType,
			billSubmissionSession: d.billSubmissionSession,
			billNumber: d.billNumber,
			status: d.status,
			voteRationale: d.voteRationale,
			myExistingScore: d.myExistingScore,
			upstreamChain: [],
			upstreamPaths: [],
			createdAt: d.createdAt,
			updatedAt: d.updatedAt
		}));

		// Attach bucketed count info at the response level
		const incomingCountBuckets: Record<number, string> = {};
		for (const [billId, count] of incomingCountByBill) {
			incomingCountBuckets[billId] = bucketCount(count);
		}

		return json({
			success: true,
			incoming: anonymizedIncoming,
			outgoing,
			isAdmin,
			debugMode: false,
			incomingCountBuckets
		});
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
	const currentUsername = locals.user.username;

	// Helper to look up bill title
	async function getBillTitle(billId: number): Promise<string | null> {
		const [b] = await db
			.select({ title: table.bill.title })
			.from(table.bill)
			.where(eq(table.bill.id, billId));
		return b?.title ?? null;
	}

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
			if (existing.delegateId === delegateId && existing.status !== 'rejected') {
				return json({ error: 'この法案は既にこのフレンドに委任されています。' }, { status: 400 });
			}
			// Allow re-delegation by updating the existing record
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

			// Mark user's answer as delegated — the delegate will decide
			await db
				.insert(table.userBillAnswer)
				.values({
					userId,
					billId,
					answer: 'delegated'
				})
				.onConflictDoUpdate({
					target: [table.userBillAnswer.userId, table.userBillAnswer.billId],
					set: {
						answer: 'delegated',
						updatedAt: sql`now()`
					}
				});

			// If the delegate already has an outgoing delegation for this bill,
			// auto-mark this new incoming as 'redelegated'
			const [delegateOutgoing] = await db
				.select()
				.from(table.voteDelegation)
				.where(
					and(
						eq(table.voteDelegation.delegatorId, delegateId),
						eq(table.voteDelegation.billId, billId)
					)
				);
			if (delegateOutgoing) {
				await db
					.update(table.voteDelegation)
					.set({ status: 'redelegated', updatedAt: new Date() })
					.where(eq(table.voteDelegation.id, existing.id));
			}

			const billTitle = await getBillTitle(billId);
			await notifyDelegationReceived(
				delegateId,
				userId,
				currentUsername,
				existing.id,
				billId,
				billTitle
			);

			return json({ success: true, message: '委任を送信しました' });
		}

		const [inserted] = await db
			.insert(table.voteDelegation)
			.values({
				delegatorId: userId,
				delegateId,
				billId,
				status: 'pending'
			})
			.returning({ id: table.voteDelegation.id });

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

		// Mark user's answer as delegated — the delegate will decide
		await db
			.insert(table.userBillAnswer)
			.values({
				userId,
				billId,
				answer: 'delegated'
			})
			.onConflictDoUpdate({
				target: [table.userBillAnswer.userId, table.userBillAnswer.billId],
				set: {
					answer: 'delegated',
					updatedAt: sql`now()`
				}
			});

		// If the delegate already has an outgoing delegation for this bill,
		// auto-mark this new incoming as 'redelegated'
		const [delegateOutgoing] = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegatorId, delegateId),
					eq(table.voteDelegation.billId, billId)
				)
			);
		if (delegateOutgoing) {
			await db
				.update(table.voteDelegation)
				.set({ status: 'redelegated', updatedAt: new Date() })
				.where(eq(table.voteDelegation.id, inserted.id));
		}

		const billTitle = await getBillTitle(billId);
		await notifyDelegationReceived(
			delegateId,
			userId,
			currentUsername,
			inserted.id,
			billId,
			billTitle
		);

		return json({ success: true, message: '委任を送信しました' });
	}

	// ── Accept a delegation and cast a vote ──
	// This applies to ALL pending incoming delegations for the same bill
	if (action === 'accept') {
		const { delegationId, score: providedScore, rationale } = body;
		const sanitizedRationale =
			typeof rationale === 'string' ? rationale.trim().slice(0, 500) : null;

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
		if (existingAnswer && existingAnswer.answer !== 'delegated') {
			score = answerToScore(existingAnswer.answer);
		} else if (providedScore !== undefined && [1, 0, -1].includes(providedScore)) {
			score = providedScore;

			// Store the delegate's own vote in user_bill_answer (single source of truth)
			await db
				.insert(table.userBillAnswer)
				.values({
					userId,
					billId: delegation.billId,
					answer: scoreToAnswer(score)
				})
				.onConflictDoUpdate({
					target: [table.userBillAnswer.userId, table.userBillAnswer.billId],
					set: {
						answer: scoreToAnswer(score),
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

		// Mark ALL pending incoming delegations as voted (with optional rationale)
		for (const d of allPending) {
			await db
				.update(table.voteDelegation)
				.set({
					status: 'voted',
					voteRationale: sanitizedRationale || null,
					updatedAt: new Date()
				})
				.where(eq(table.voteDelegation.id, d.id));
		}

		// Notify all direct delegators
		const billTitle = await getBillTitle(delegation.billId);
		for (const d of allPending) {
			await notifyDelegationVoted(
				d.delegatorId,
				userId,
				currentUsername,
				d.id,
				delegation.billId,
				billTitle,
				score,
				sanitizedRationale
			);
		}

		// Notify all upstream delegators in redelegation chains
		await notifyUpstreamDelegatorsVoted(
			userId,
			userId,
			currentUsername,
			delegation.billId,
			billTitle,
			score,
			sanitizedRationale
		);

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

		// Mark user's answer as delegated — the new delegate will decide
		await db
			.insert(table.userBillAnswer)
			.values({
				userId,
				billId: delegation.billId,
				answer: 'delegated'
			})
			.onConflictDoUpdate({
				target: [table.userBillAnswer.userId, table.userBillAnswer.billId],
				set: {
					answer: 'delegated',
					updatedAt: sql`now()`
				}
			});

		// Notify the new delegate about the incoming delegation
		const billTitle = await getBillTitle(delegation.billId);
		const outDelegationId =
			existingOutgoing?.id ??
			(await db
				.select({ id: table.voteDelegation.id })
				.from(table.voteDelegation)
				.where(
					and(
						eq(table.voteDelegation.delegatorId, userId),
						eq(table.voteDelegation.billId, delegation.billId)
					)
				)
				.then((r: { id: number }[]) => r[0]?.id));
		if (outDelegationId) {
			await notifyDelegationReceived(
				newDelegateId,
				userId,
				currentUsername,
				outDelegationId,
				delegation.billId,
				billTitle
			);
		}
		// Notify original delegators that their delegation was redelegated
		const redelegatedUpstream = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'redelegated')
				)
			);
		for (const d of redelegatedUpstream) {
			await notifyDelegationRedelegated(
				d.delegatorId,
				userId,
				currentUsername,
				d.id,
				delegation.billId,
				billTitle
			);
		}

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

		// Find all pending delegations for this bill before rejecting (for notifications)
		const allPendingForBill = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'pending')
				)
			);

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

		// Remove 'delegated' answer for each rejected delegator so they can vote again
		for (const d of allPendingForBill) {
			await db
				.delete(table.userBillAnswer)
				.where(
					and(
						eq(table.userBillAnswer.userId, d.delegatorId),
						eq(table.userBillAnswer.billId, delegation.billId),
						eq(table.userBillAnswer.answer, 'delegated')
					)
				);
		}

		// Notify all delegators
		const billTitle = await getBillTitle(delegation.billId);
		for (const d of allPendingForBill) {
			await notifyDelegationRejected(
				d.delegatorId,
				userId,
				currentUsername,
				d.id,
				delegation.billId,
				billTitle
			);
		}

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

		// Remove the 'delegated' answer so user can vote again
		await db
			.delete(table.userBillAnswer)
			.where(
				and(
					eq(table.userBillAnswer.userId, userId),
					eq(table.userBillAnswer.billId, delegation.billId),
					eq(table.userBillAnswer.answer, 'delegated')
				)
			);

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

		// Notify the delegate that the delegation was retracted
		const billTitle = await getBillTitle(delegation.billId);
		await notifyDelegationRetracted(
			delegation.delegateId,
			userId,
			currentUsername,
			delegationId,
			delegation.billId,
			billTitle
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
			.set({ status: 'pending', voteRationale: null, updatedAt: new Date() })
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

		// Find ALL rejected delegations for this bill before reverting
		const allRejectedForBill = await db
			.select()
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegateId, userId),
					eq(table.voteDelegation.billId, delegation.billId),
					eq(table.voteDelegation.status, 'rejected')
				)
			);

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

		// Restore 'delegated' answer for each delegator (was deleted during rejection)
		for (const d of allRejectedForBill) {
			await db
				.insert(table.userBillAnswer)
				.values({
					userId: d.delegatorId,
					billId: delegation.billId,
					answer: 'delegated'
				})
				.onConflictDoUpdate({
					target: [table.userBillAnswer.userId, table.userBillAnswer.billId],
					set: {
						answer: 'delegated',
						updatedAt: sql`now()`
					}
				});
		}

		return json({ success: true, message: '拒否を取り消し、保留に戻しました' });
	}

	return json({ error: '無効なアクションです' }, { status: 400 });
};
