import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { NewNotification } from '$lib/server/db/schema';

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
	senderUsername: string,
	requestId: number
) {
	await createNotification({
		userId: receiverId,
		type: 'friend_request_received',
		actorId: undefined,
		resourceId: requestId,
		message: `${senderUsername} さんからフレンドリクエストが届きました`
	});
}

export async function notifyFriendRequestAccepted(
	senderId: string,
	receiverUsername: string,
	requestId: number
) {
	await createNotification({
		userId: senderId,
		type: 'friend_request_accepted',
		resourceId: requestId,
		message: `${receiverUsername} さんがフレンドリクエストを承認しました`
	});
}

export async function notifyFriendRequestRejected(
	senderId: string,
	receiverUsername: string,
	requestId: number
) {
	await createNotification({
		userId: senderId,
		type: 'friend_request_rejected',
		resourceId: requestId,
		message: `${receiverUsername} さんがフレンドリクエストを拒否しました`
	});
}

// ── Delegation notification helpers ──

export async function notifyDelegationReceived(
	delegateId: string,
	delegatorUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegateId,
		type: 'delegation_received',
		resourceId: delegationId,
		billId,
		message: `${delegatorUsername} さんが${billLabel}の投票を委任しました`
	});
}

export async function notifyDelegationRejected(
	delegatorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegatorId,
		type: 'delegation_rejected',
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}の委任を拒否しました`
	});
}

export async function notifyDelegationRedelegated(
	delegatorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	await createNotification({
		userId: delegatorId,
		type: 'delegation_redelegated',
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}の委任を他のフレンドに転送しました`
	});
}

export async function notifyDelegationVoted(
	delegatorId: string,
	delegateUsername: string,
	delegationId: number,
	billId: number,
	billTitle: string | null,
	score: number
) {
	const billLabel = billTitle ? `「${billTitle}」` : `法案#${billId}`;
	const voteLabel = score === 1 ? '賛成' : score === -1 ? '反対' : 'わからない';
	await createNotification({
		userId: delegatorId,
		type: 'delegation_voted',
		resourceId: delegationId,
		billId,
		message: `${delegateUsername} さんが${billLabel}に「${voteLabel}」と委任投票しました`
	});
}

export async function notifyDelegationRetracted(
	delegateId: string,
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
		message: `${delegatorUsername} さんが${billLabel}の委任を取り消しました`
	});
}
