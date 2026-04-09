import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { NewNotification } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

type NotificationType = NewNotification['type'];

export async function createNotification(params: {
	userId: string;
	type: NotificationType;
	actorId?: string;
	resourceId?: number;
	billId?: number;
	message: string;
}) {
	await db.insert(table.notification).values({
		userId: params.userId,
		type: params.type,
		actorId: params.actorId ?? null,
		resourceId: params.resourceId ?? null,
		billId: params.billId ?? null,
		message: params.message
	});
}

// ── Friend notification helpers ──

export async function notifyFriendRequestReceived(
	receiverId: string,
	senderId: string,
	senderUsername: string,
	requestId: number
) {
	await createNotification({
		userId: receiverId,
		type: 'friend_request_received',
		actorId: senderId,
		resourceId: requestId,
		message: `${senderUsername} さんからフレンドリクエストが届きました`
	});
}

export async function notifyFriendRequestAccepted(
	senderId: string,
	actorId: string,
	receiverUsername: string,
	requestId: number
) {
	await createNotification({
		userId: senderId,
		type: 'friend_request_accepted',
		actorId,
		resourceId: requestId,
		message: `${receiverUsername} さんがフレンドリクエストを承認しました`
	});
}

export async function notifyFriendRequestRejected(
	senderId: string,
	actorId: string,
	receiverUsername: string,
	requestId: number
) {
	await createNotification({
		userId: senderId,
		type: 'friend_request_rejected',
		actorId,
		resourceId: requestId,
		message: `${receiverUsername} さんがフレンドリクエストを拒否しました`
	});
}

// ── Delegation notification helpers ──

export async function notifyDelegationReceived(
	delegateId: string,
	delegatorId: string,
	delegatorUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegateId,
		type: 'delegation_received',
		actorId: undefined, // anonymous: don't reveal who delegated
		resourceId: delegationId,
		billId,
		message: `${billLabel}の投票があなたに委任されました`
	});
}

export async function notifyDelegationRejected(
	delegatorId: string,
	actorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegatorId,
		type: 'delegation_rejected',
		actorId,
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}の委任を拒否しました`
	});
}

export async function notifyDelegationRedelegated(
	delegatorId: string,
	actorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegatorId,
		type: 'delegation_redelegated',
		actorId,
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}の委任を他のフレンドに転送しました`
	});
}

export async function notifyDelegationVoted(
	delegatorId: string,
	actorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null,
	score: number,
	rationale?: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	const voteLabel = score === 1 ? '賛成' : score === -1 ? '反対' : 'わからない';
	const rationaleText = rationale ? `\n理由: ${rationale}` : '';
	await createNotification({
		userId: delegatorId,
		type: 'delegation_voted',
		actorId,
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}に「${voteLabel}」と委任投票しました${rationaleText}`
	});
}

export async function notifyDelegationRetracted(
	delegateId: string,
	delegatorId: string,
	delegatorUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegateId,
		type: 'delegation_retracted',
		resourceId: delegationId,
		billId,
		message: `${billLabel}の委任が取り消されました`
	});
}

export async function notifyDelegationVoteChanged(
	delegatorId: string,
	actorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null,
	newScore: number
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	const voteLabel = newScore === 1 ? '賛成' : newScore === -1 ? '反対' : 'わからない';
	await createNotification({
		userId: delegatorId,
		type: 'delegation_vote_changed',
		actorId,
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}の委任投票を「${voteLabel}」に変更しました`
	});
}

export async function notifyDelegationOverridden(
	delegateId: string,
	delegatorId: string,
	delegatorUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegateId,
		type: 'delegation_overridden',
		resourceId: delegationId,
		billId,
		message: `${billLabel}の委任者が直接投票し、委任が取り消されました`
	});
}

/**
 * Notify all upstream delegators in a redelegation chain that their vote was resolved.
 * Walks up from the direct delegators through 'redelegated' status chains.
 *
 * Uses a single batch query to load all redelegated delegations for the bill,
 * then traverses the graph in memory.
 */
export async function notifyUpstreamDelegatorsVoted(
	delegateId: string,
	actorId: string,
	voterUsername: string,
	billId: number,
	billTitle: string | null,
	score: number,
	rationale?: string | null
) {
	const MAX_DEPTH = 100;

	// Batch: get ALL redelegated delegations for this bill in one query
	const allRedelegated = await db
		.select({
			id: table.voteDelegation.id,
			delegatorId: table.voteDelegation.delegatorId,
			delegateId: table.voteDelegation.delegateId
		})
		.from(table.voteDelegation)
		.where(
			and(eq(table.voteDelegation.billId, billId), eq(table.voteDelegation.status, 'redelegated'))
		);

	// Build graph: delegateId -> list of { id, delegatorId }
	const upstreamMap = new Map<string, Array<{ id: number; delegatorId: string }>>();
	for (const d of allRedelegated) {
		let list = upstreamMap.get(d.delegateId);
		if (!list) {
			list = [];
			upstreamMap.set(d.delegateId, list);
		}
		list.push({ id: d.id, delegatorId: d.delegatorId });
	}

	// BFS in memory
	const visited = new Set<string>();
	const queue: string[] = [delegateId];

	while (queue.length > 0 && visited.size < MAX_DEPTH) {
		const currentDelegateId = queue.shift()!;
		if (visited.has(currentDelegateId)) continue;
		visited.add(currentDelegateId);

		const redelegated = upstreamMap.get(currentDelegateId) || [];
		for (const d of redelegated) {
			await notifyDelegationVoted(
				d.delegatorId,
				actorId,
				voterUsername,
				d.id,
				billId,
				billTitle,
				score,
				rationale
			);
			queue.push(d.delegatorId);
		}
	}
}

/**
 * Notify all upstream delegators in a chain that the delegate's vote changed.
 *
 * Uses a single batch query to load all redelegated delegations for the bill,
 * then traverses the graph in memory.
 */
export async function notifyUpstreamDelegatorsVoteChanged(
	delegateId: string,
	actorId: string,
	voterUsername: string,
	billId: number,
	billTitle: string | null,
	newScore: number
) {
	const MAX_DEPTH = 100;

	// Batch: get ALL redelegated delegations for this bill in one query
	const allRedelegated = await db
		.select({
			id: table.voteDelegation.id,
			delegatorId: table.voteDelegation.delegatorId,
			delegateId: table.voteDelegation.delegateId
		})
		.from(table.voteDelegation)
		.where(
			and(eq(table.voteDelegation.billId, billId), eq(table.voteDelegation.status, 'redelegated'))
		);

	// Build graph: delegateId -> list of { id, delegatorId }
	const upstreamMap = new Map<string, Array<{ id: number; delegatorId: string }>>();
	for (const d of allRedelegated) {
		let list = upstreamMap.get(d.delegateId);
		if (!list) {
			list = [];
			upstreamMap.set(d.delegateId, list);
		}
		list.push({ id: d.id, delegatorId: d.delegatorId });
	}

	// BFS in memory
	const visited = new Set<string>();
	const queue: string[] = [delegateId];

	while (queue.length > 0 && visited.size < MAX_DEPTH) {
		const currentDelegateId = queue.shift()!;
		if (visited.has(currentDelegateId)) continue;
		visited.add(currentDelegateId);

		const redelegated = upstreamMap.get(currentDelegateId) || [];
		for (const d of redelegated) {
			await notifyDelegationVoteChanged(
				d.delegatorId,
				actorId,
				voterUsername,
				d.id,
				billId,
				billTitle,
				newScore
			);
			queue.push(d.delegatorId);
		}
	}
}
