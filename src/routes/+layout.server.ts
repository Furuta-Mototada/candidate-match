import { eq, and, count } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	let pendingFriendRequests = 0;

	if (locals.user) {
		const [result] = await db
			.select({ count: count() })
			.from(table.friendRequest)
			.where(
				and(
					eq(table.friendRequest.receiverId, locals.user.id),
					eq(table.friendRequest.status, 'pending')
				)
			);
		pendingFriendRequests = result?.count ?? 0;
	}

	return {
		user: locals.user,
		pendingFriendRequests
	};
};
