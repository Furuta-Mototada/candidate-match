import { eq, and, or, inArray } from 'drizzle-orm';
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

export type UpstreamNode = {
	username: string;
	status: string;
	upstream: UpstreamNode[];
};

/**
 * Build full upstream tree: find ALL people who delegated to this user for a bill,
 * recursively including all their upstream delegators.
 *
 * Returns an array of UpstreamNode (each direct delegator, with their own upstream tree).
 */
export async function getDelegationTreeUpstream(
	userId: string,
	billId: number,
	visited: Set<string> = new Set()
): Promise<UpstreamNode[]> {
	if (visited.has(userId)) return [];
	visited.add(userId);

	const upstreamDelegations = await db
		.select({
			delegatorId: table.voteDelegation.delegatorId,
			delegatorUsername: table.user.username,
			status: table.voteDelegation.status
		})
		.from(table.voteDelegation)
		.innerJoin(table.user, eq(table.voteDelegation.delegatorId, table.user.id))
		.where(
			and(eq(table.voteDelegation.delegateId, userId), eq(table.voteDelegation.billId, billId))
		);

	const nodes: UpstreamNode[] = [];
	for (const d of upstreamDelegations) {
		const children = await getDelegationTreeUpstream(d.delegatorId, billId, visited);
		nodes.push({
			username: d.delegatorUsername,
			status: d.status,
			upstream: children
		});
	}
	return nodes;
}

/**
 * Flatten an upstream tree into an array of paths (each path from leaf to root).
 * Each path is ordered leaf-first: [leaf, ..., directDelegator].
 */
export function flattenUpstreamTree(
	nodes: UpstreamNode[]
): Array<Array<{ username: string; status: string }>> {
	const paths: Array<Array<{ username: string; status: string }>> = [];
	for (const node of nodes) {
		if (node.upstream.length === 0) {
			paths.push([{ username: node.username, status: node.status }]);
		} else {
			const childPaths = flattenUpstreamTree(node.upstream);
			for (const cp of childPaths) {
				paths.push([...cp, { username: node.username, status: node.status }]);
			}
		}
	}
	return paths;
}

/**
 * Count total votes a user controls for a bill.
 * Returns 1 (own vote) + count of all upstream delegators in the tree.
 */
export async function countTotalVotes(userId: string, billId: number): Promise<number> {
	const tree = await getDelegationTreeUpstream(userId, billId);
	function countNodes(nodes: UpstreamNode[]): number {
		let count = 0;
		for (const n of nodes) {
			count += 1 + countNodes(n.upstream);
		}
		return count;
	}
	return 1 + countNodes(tree);
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

/**
 * Resolve all delegated votes for a user.
 *
 * For each bill where the user has an outgoing delegation, walks the delegation
 * chain to find the terminal voter. If the chain ends with a 'voted' status,
 * looks up the terminal voter's userBillAnswer and returns the resolved score.
 *
 * Optionally filter to specific billIds for efficiency.
 *
 * Returns a Map of billId -> resolved score (from the terminal voter).
 */
export async function resolveDelegatedVotes(
	userId: string,
	filterBillIds?: number[]
): Promise<Map<number, number>> {
	// Find all outgoing delegations for this user
	if (filterBillIds && filterBillIds.length === 0) return new Map();

	const outgoing = filterBillIds
		? await db
				.select({
					billId: table.voteDelegation.billId,
					delegateId: table.voteDelegation.delegateId,
					status: table.voteDelegation.status
				})
				.from(table.voteDelegation)
				.where(
					and(
						eq(table.voteDelegation.delegatorId, userId),
						inArray(table.voteDelegation.billId, filterBillIds)
					)
				)
		: await db
				.select({
					billId: table.voteDelegation.billId,
					delegateId: table.voteDelegation.delegateId,
					status: table.voteDelegation.status
				})
				.from(table.voteDelegation)
				.where(eq(table.voteDelegation.delegatorId, userId));

	if (outgoing.length === 0) return new Map();

	const result = new Map<number, number>();

	for (const delegation of outgoing) {
		let currentDelegateId = delegation.delegateId;
		let currentStatus = delegation.status;
		const visited = new Set<string>();

		// Walk the chain until we find a terminal state
		while (
			(currentStatus === 'redelegated' || currentStatus === 'pending') &&
			!visited.has(currentDelegateId)
		) {
			visited.add(currentDelegateId);

			const [next] = await db
				.select({
					delegateId: table.voteDelegation.delegateId,
					status: table.voteDelegation.status
				})
				.from(table.voteDelegation)
				.where(
					and(
						eq(table.voteDelegation.delegatorId, currentDelegateId),
						eq(table.voteDelegation.billId, delegation.billId)
					)
				)
				.limit(1);

			if (!next) break;
			currentDelegateId = next.delegateId;
			currentStatus = next.status;
		}

		// If the chain ended with a vote, look up the terminal voter's answer
		if (currentStatus === 'voted') {
			const [answer] = await db
				.select({ score: table.userBillAnswer.score })
				.from(table.userBillAnswer)
				.where(
					and(
						eq(table.userBillAnswer.userId, currentDelegateId),
						eq(table.userBillAnswer.billId, delegation.billId)
					)
				);

			if (answer) {
				result.set(delegation.billId, answer.score);
			}
		}
	}

	return result;
}
