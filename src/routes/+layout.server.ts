import { eq, and, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	let pendingFriendRequests = 0;
	let unreadNotifications = 0;

	if (locals.user) {
		const [friendResult, notifResult] = await Promise.all([
			db
				.select({ count: count() })
				.from(table.friendRequest)
				.where(
					and(
						eq(table.friendRequest.receiverId, locals.user.id),
						eq(table.friendRequest.status, 'pending')
					)
				),
			db
				.select({ count: count() })
				.from(table.notification)
				.where(
					and(eq(table.notification.userId, locals.user.id), eq(table.notification.read, false))
				)
		]);
		pendingFriendRequests = friendResult[0]?.count ?? 0;
		unreadNotifications = notifResult[0]?.count ?? 0;
	}

	return {
		user: locals.user,
		pendingFriendRequests,
		unreadNotifications
	};
};
