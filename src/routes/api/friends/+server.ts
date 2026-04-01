import { json } from '@sveltejs/kit';
import { eq, or, and, ilike, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { RequestHandler } from './$types.js';
import {
	notifyFriendRequestReceived,
	notifyFriendRequestAccepted,
	notifyFriendRequestRejected
} from '$lib/server/notifications';

// GET /api/friends?action=list|search|requests
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const action = url.searchParams.get('action') ?? 'list';
	const userId = locals.user.id;

	if (action === 'search') {
		const query = url.searchParams.get('q')?.trim();
		if (!query || query.length < 1) {
			return json({ users: [] });
		}

		// Single query with LEFT JOIN to get users + friend status
		const results = await db
			.select({
				id: table.user.id,
				username: table.user.username,
				avatarUrl: table.user.avatarUrl,
				requestId: table.friendRequest.id,
				senderId: table.friendRequest.senderId,
				requestStatus: table.friendRequest.status
			})
			.from(table.user)
			.leftJoin(
				table.friendRequest,
				or(
					and(
						eq(table.friendRequest.senderId, sql`${userId}`),
						eq(table.friendRequest.receiverId, table.user.id)
					),
					and(
						eq(table.friendRequest.senderId, table.user.id),
						eq(table.friendRequest.receiverId, sql`${userId}`)
					)
				)
			)
			.where(and(ilike(table.user.username, `%${query}%`), ne(table.user.id, userId)))
			.limit(20);

		const usersWithStatus = results.map((row: (typeof results)[number]) => {
			let friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected' =
				'none';
			if (row.requestStatus) {
				if (row.requestStatus === 'accepted') {
					friendStatus = 'accepted';
				} else if (row.requestStatus === 'pending') {
					friendStatus = row.senderId === userId ? 'pending_sent' : 'pending_received';
				} else if (row.requestStatus === 'rejected') {
					friendStatus = 'rejected';
				}
			}
			return { id: row.id, username: row.username, avatarUrl: row.avatarUrl, friendStatus };
		});

		return json({ users: usersWithStatus });
	}

	if (action === 'requests') {
		// Run both queries in parallel
		const [incoming, outgoing] = await Promise.all([
			db
				.select({
					id: table.friendRequest.id,
					senderId: table.friendRequest.senderId,
					senderUsername: table.user.username,
					senderAvatarUrl: table.user.avatarUrl,
					createdAt: table.friendRequest.createdAt
				})
				.from(table.friendRequest)
				.innerJoin(table.user, eq(table.friendRequest.senderId, table.user.id))
				.where(
					and(eq(table.friendRequest.receiverId, userId), eq(table.friendRequest.status, 'pending'))
				)
				.orderBy(table.friendRequest.createdAt),
			db
				.select({
					id: table.friendRequest.id,
					receiverId: table.friendRequest.receiverId,
					receiverUsername: table.user.username,
					receiverAvatarUrl: table.user.avatarUrl,
					createdAt: table.friendRequest.createdAt
				})
				.from(table.friendRequest)
				.innerJoin(table.user, eq(table.friendRequest.receiverId, table.user.id))
				.where(
					and(eq(table.friendRequest.senderId, userId), eq(table.friendRequest.status, 'pending'))
				)
				.orderBy(table.friendRequest.createdAt)
		]);

		return json({ incoming, outgoing });
	}

	// Default: list accepted friends — run both directions in parallel
	const [sentFriends, receivedFriends] = await Promise.all([
		db
			.select({
				requestId: table.friendRequest.id,
				friendId: table.friendRequest.receiverId,
				friendUsername: table.user.username,
				friendAvatarUrl: table.user.avatarUrl,
				since: table.friendRequest.updatedAt
			})
			.from(table.friendRequest)
			.innerJoin(table.user, eq(table.friendRequest.receiverId, table.user.id))
			.where(
				and(eq(table.friendRequest.senderId, userId), eq(table.friendRequest.status, 'accepted'))
			),
		db
			.select({
				requestId: table.friendRequest.id,
				friendId: table.friendRequest.senderId,
				friendUsername: table.user.username,
				friendAvatarUrl: table.user.avatarUrl,
				since: table.friendRequest.updatedAt
			})
			.from(table.friendRequest)
			.innerJoin(table.user, eq(table.friendRequest.senderId, table.user.id))
			.where(
				and(eq(table.friendRequest.receiverId, userId), eq(table.friendRequest.status, 'accepted'))
			)
	]);

	const friends = [...sentFriends, ...receivedFriends].sort((a, b) =>
		a.friendUsername.localeCompare(b.friendUsername)
	);

	return json({ friends });
};

// POST /api/friends
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const body = await request.json();
	const { action } = body;
	const userId = locals.user.id;

	// Send a friend request
	if (action === 'send') {
		const { receiverId } = body;
		if (!receiverId) {
			return json({ error: 'ユーザーIDが必要です' }, { status: 400 });
		}
		if (receiverId === userId) {
			return json({ error: '自分にリクエストは送れません' }, { status: 400 });
		}

		// Check receiver exists
		const [receiver] = await db
			.select({ id: table.user.id })
			.from(table.user)
			.where(eq(table.user.id, receiverId));

		if (!receiver) {
			return json({ error: 'ユーザーが見つかりません' }, { status: 404 });
		}

		// Check for existing request in either direction
		const [existing] = await db
			.select({
				id: table.friendRequest.id,
				status: table.friendRequest.status,
				senderId: table.friendRequest.senderId
			})
			.from(table.friendRequest)
			.where(
				or(
					and(
						eq(table.friendRequest.senderId, userId),
						eq(table.friendRequest.receiverId, receiverId)
					),
					and(
						eq(table.friendRequest.senderId, receiverId),
						eq(table.friendRequest.receiverId, userId)
					)
				)
			);

		if (existing) {
			if (existing.status === 'accepted') {
				return json({ error: 'すでにフレンドです' }, { status: 400 });
			}
			if (existing.status === 'pending') {
				// If the other user already sent a request, auto-accept
				if (existing.senderId === receiverId) {
					await db
						.update(table.friendRequest)
						.set({ status: 'accepted', updatedAt: new Date() })
						.where(eq(table.friendRequest.id, existing.id));
					await notifyFriendRequestAccepted(receiverId, userId, locals.user!.username, existing.id);
					return json({ success: true, message: 'フレンドになりました！' });
				}
				return json({ error: 'リクエスト送信済みです' }, { status: 400 });
			}
			// If previously rejected, allow re-sending by updating the row
			if (existing.status === 'rejected') {
				await db
					.update(table.friendRequest)
					.set({ senderId: userId, receiverId, status: 'pending', updatedAt: new Date() })
					.where(eq(table.friendRequest.id, existing.id));
				await notifyFriendRequestReceived(receiverId, userId, locals.user!.username, existing.id);
				return json({ success: true, message: 'リクエストを送信しました' });
			}
		}

		const [inserted] = await db
			.insert(table.friendRequest)
			.values({
				senderId: userId,
				receiverId,
				status: 'pending'
			})
			.returning({ id: table.friendRequest.id });

		await notifyFriendRequestReceived(receiverId, userId, locals.user!.username, inserted.id);

		return json({ success: true, message: 'リクエストを送信しました' });
	}

	// Respond to a friend request
	if (action === 'respond') {
		const { requestId, response } = body;
		if (!requestId || !['accepted', 'rejected'].includes(response)) {
			return json({ error: '無効なリクエストです' }, { status: 400 });
		}

		const [req] = await db
			.select()
			.from(table.friendRequest)
			.where(
				and(
					eq(table.friendRequest.id, requestId),
					eq(table.friendRequest.receiverId, userId),
					eq(table.friendRequest.status, 'pending')
				)
			);

		if (!req) {
			return json({ error: 'リクエストが見つかりません' }, { status: 404 });
		}

		await db
			.update(table.friendRequest)
			.set({ status: response, updatedAt: new Date() })
			.where(eq(table.friendRequest.id, requestId));

		if (response === 'accepted') {
			await notifyFriendRequestAccepted(req.senderId, userId, locals.user!.username, requestId);
		} else {
			await notifyFriendRequestRejected(req.senderId, userId, locals.user!.username, requestId);
		}

		return json({
			success: true,
			message: response === 'accepted' ? 'フレンドになりました！' : 'リクエストを拒否しました'
		});
	}

	// Remove a friend
	if (action === 'remove') {
		const { friendId } = body;
		if (!friendId) {
			return json({ error: 'フレンドIDが必要です' }, { status: 400 });
		}

		await db
			.delete(table.friendRequest)
			.where(
				and(
					eq(table.friendRequest.status, 'accepted'),
					or(
						and(
							eq(table.friendRequest.senderId, userId),
							eq(table.friendRequest.receiverId, friendId)
						),
						and(
							eq(table.friendRequest.senderId, friendId),
							eq(table.friendRequest.receiverId, userId)
						)
					)
				)
			);

		return json({ success: true, message: 'フレンドを削除しました' });
	}

	// Cancel a sent request
	if (action === 'cancel') {
		const { requestId } = body;
		if (!requestId) {
			return json({ error: 'リクエストIDが必要です' }, { status: 400 });
		}

		await db
			.delete(table.friendRequest)
			.where(
				and(
					eq(table.friendRequest.id, requestId),
					eq(table.friendRequest.senderId, userId),
					eq(table.friendRequest.status, 'pending')
				)
			);

		return json({ success: true, message: 'リクエストを取り消しました' });
	}

	return json({ error: '無効なアクションです' }, { status: 400 });
};
