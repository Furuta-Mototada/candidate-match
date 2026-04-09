import { eq, and, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	let pendingFriendRequests = 0;
	let unreadNotifications = 0;

	if (locals.user) {
		const [friendResult, notifResult] = await Promise.allSettled([
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
		if (friendResult.status === 'fulfilled') {
			pendingFriendRequests = friendResult.value[0]?.count ?? 0;
		} else {
			console.error('Failed to load friend request count:', friendResult.reason);
		}
		if (notifResult.status === 'fulfilled') {
			unreadNotifications = notifResult.value[0]?.count ?? 0;
		} else {
			console.error('Failed to load notification count:', notifResult.reason);
		}
	}

	return {
		user: locals.user,
		pendingFriendRequests,
		unreadNotifications
	};
};
