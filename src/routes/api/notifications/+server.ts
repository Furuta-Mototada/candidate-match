import { json } from '@sveltejs/kit';
import { eq, and, desc, count, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { RequestHandler } from './$types.js';

// GET /api/notifications?action=list|unread-count&limit=N&before=ID
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const action = url.searchParams.get('action') ?? 'list';
	const userId = locals.user.id;

	if (action === 'unread-count') {
		const [result] = await db
			.select({ count: count() })
			.from(table.notification)
			.where(and(eq(table.notification.userId, userId), eq(table.notification.read, false)));

		return json({ count: result?.count ?? 0 });
	}

	// Default: list notifications with pagination
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 50);
	const beforeId = url.searchParams.get('before');

	const conditions = [eq(table.notification.userId, userId)];
	if (beforeId) {
		conditions.push(lt(table.notification.id, parseInt(beforeId)));
	}

	const notifications = await db
		.select({
			id: table.notification.id,
			type: table.notification.type,
			actorId: table.notification.actorId,
			actorUsername: table.user.username,
			actorAvatarUrl: table.user.avatarUrl,
			resourceId: table.notification.resourceId,
			billId: table.notification.billId,
			message: table.notification.message,
			read: table.notification.read,
			createdAt: table.notification.createdAt
		})
		.from(table.notification)
		.leftJoin(table.user, eq(table.notification.actorId, table.user.id))
		.where(and(...conditions))
		.orderBy(desc(table.notification.createdAt))
		.limit(limit + 1);

	const hasMore = notifications.length > limit;
	const items = hasMore ? notifications.slice(0, limit) : notifications;

	return json({ notifications: items, hasMore });
};

// POST /api/notifications
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}

	const body = await request.json();
	const { action } = body;
	const userId = locals.user.id;

	// Mark a single notification as read
	if (action === 'mark-read') {
		const { notificationId } = body;
		if (!notificationId) {
			return json({ error: '通知IDが必要です' }, { status: 400 });
		}

		await db
			.update(table.notification)
			.set({ read: true })
			.where(and(eq(table.notification.id, notificationId), eq(table.notification.userId, userId)));

		return json({ success: true });
	}

	// Mark all notifications as read
	if (action === 'mark-all-read') {
		await db
			.update(table.notification)
			.set({ read: true })
			.where(and(eq(table.notification.userId, userId), eq(table.notification.read, false)));

		return json({ success: true });
	}

	return json({ error: '無効なアクションです' }, { status: 400 });
};
