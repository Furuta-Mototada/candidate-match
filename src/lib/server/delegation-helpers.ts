import { eq, and, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

/**
 * Get the downstream delegation chain: who did the delegate forward this to?
 * Returns an array of { username, status } representing the chain after the delegate.
 *
 * Walks forward from startUserId following outgoing delegations.
 * Stops when: no further delegation exists, or the status is terminal (not 'redelegated'/'pending').
 */
export async function getDelegationChainDownstream(
	startUserId: string,
	billId: number
): Promise<{ username: string; status: string }[]> {
	const chain: { username: string; status: string }[] = [];
	const visited = new Set<string>();
	let current = startUserId;

	while (current && !visited.has(current)) {
		visited.add(current);

		const [delegation] = await db
			.select({
				delegateId: table.voteDelegation.delegateId,
				delegateUsername: table.user.username,
				status: table.voteDelegation.status
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegateId, table.user.id))
			.where(
				and(eq(table.voteDelegation.delegatorId, current), eq(table.voteDelegation.billId, billId))
			)
			.limit(1);

		if (!delegation) break;

		chain.push({ username: delegation.delegateUsername, status: delegation.status });
		if (delegation.status !== 'redelegated' && delegation.status !== 'pending') break;
		current = delegation.delegateId;
	}

	return chain;
}

/**
 * Get the upstream delegation chain: who originally delegated this bill?
 * Returns an array of { username, status } from the original delegator down to the current one.
 *
 * Walks backward from startDelegatorId following 'redelegated' incoming delegations.
 */
export async function getDelegationChainUpstream(
	startDelegatorId: string,
	billId: number
): Promise<{ username: string; status: string }[]> {
	const chain: { username: string; status: string }[] = [];
	const visited = new Set<string>();
	let current = startDelegatorId;

	while (current && !visited.has(current)) {
		visited.add(current);

		const [upstream] = await db
			.select({
				delegatorId: table.voteDelegation.delegatorId,
				delegatorUsername: table.user.username,
				status: table.voteDelegation.status
			})
			.from(table.voteDelegation)
			.innerJoin(table.user, eq(table.voteDelegation.delegatorId, table.user.id))
			.where(
				and(
					eq(table.voteDelegation.delegateId, current),
					eq(table.voteDelegation.billId, billId),
					eq(table.voteDelegation.status, 'redelegated')
				)
			)
			.limit(1);

		if (!upstream) break;

		chain.unshift({ username: upstream.delegatorUsername, status: upstream.status });
		current = upstream.delegatorId;
	}

	return chain;
}

/**
 * Check if two users are friends (accepted friend request in either direction)
 */
export async function checkFriendship(userA: string, userB: string): Promise<boolean> {
	const [friendship] = await db
		.select({ id: table.friendRequest.id })
		.from(table.friendRequest)
		.where(
			and(
				eq(table.friendRequest.status, 'accepted'),
				or(
					and(eq(table.friendRequest.senderId, userA), eq(table.friendRequest.receiverId, userB)),
					and(eq(table.friendRequest.senderId, userB), eq(table.friendRequest.receiverId, userA))
				)
			)
		)
		.limit(1);

	return !!friendship;
}

/**
 * Detect if creating a delegation from delegatorId -> delegateId for billId
 * would create a cycle.
 *
 * Follows the chain of active delegations from delegateId;
 * if it eventually reaches delegatorId, a cycle would be formed.
 */
export async function detectDelegationCycle(
	delegatorId: string,
	delegateId: string,
	billId: number
): Promise<boolean> {
	const visited = new Set<string>();
	visited.add(delegatorId);

	let current = delegateId;

	while (current) {
		if (visited.has(current)) {
			return true;
		}
		visited.add(current);

		const [nextDelegation] = await db
			.select({ delegateId: table.voteDelegation.delegateId })
			.from(table.voteDelegation)
			.where(
				and(
					eq(table.voteDelegation.delegatorId, current),
					eq(table.voteDelegation.billId, billId),
					or(
						eq(table.voteDelegation.status, 'pending'),
						eq(table.voteDelegation.status, 'redelegated')
					)
				)
			)
			.limit(1);

		if (!nextDelegation) {
			break;
		}

		current = nextDelegation.delegateId;
	}

	return false;
}
