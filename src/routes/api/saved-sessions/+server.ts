import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import {
	resultSnapshot,
	userBillAnswer,
	billClusterAssignments,
	bill,
	billClusters
} from '$lib/server/db/schema.js';
import { eq, desc, and, inArray } from 'drizzle-orm';
import type { GlobalMemberScore, SnapshotListItem } from '$lib/types/index.js';

/**
 * GET /api/saved-sessions
 *
 * Query params:
 * - id=N : Get specific snapshot details
 * - (none) : List all snapshots for current user
 * - answers=true : Get user's bill answers summary
 * - answers=true&clusterId=N : Get answers for a specific cluster
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const snapshotId = url.searchParams.get('id');
		const wantAnswers = url.searchParams.get('answers');
		const answerClusterId = url.searchParams.get('clusterId');

		if (wantAnswers === 'true') {
			return await getAnswers(locals.user.id, answerClusterId ? parseInt(answerClusterId) : null);
		}

		if (snapshotId) {
			return await getSnapshotDetails(parseInt(snapshotId), locals.user.id);
		}

		// List all snapshots
		const snapshots = await db
			.select()
			.from(resultSnapshot)
			.where(eq(resultSnapshot.userId, locals.user.id))
			.orderBy(desc(resultSnapshot.createdAt));

		const snapshotList: SnapshotListItem[] = snapshots.map((s) => {
			const globalScores: GlobalMemberScore[] = JSON.parse(s.globalScoresJson);
			const topMatch =
				globalScores.length > 0
					? { name: globalScores[0].name, score: globalScores[0].globalScore }
					: null;

			return {
				id: s.id,
				name: s.name,
				clusterId: s.clusterId,
				nComponents: s.nComponents,
				totalAnswered: s.totalAnswered,
				topMatch,
				createdAt: s.createdAt.toISOString()
			};
		});

		return json({
			success: true,
			snapshots: snapshotList
		});
	} catch (error) {
		console.error('Error fetching saved data:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

/**
 * Get detailed snapshot info
 */
async function getSnapshotDetails(snapshotId: number, userId: string) {
	const [snapshot] = await db
		.select()
		.from(resultSnapshot)
		.where(and(eq(resultSnapshot.id, snapshotId), eq(resultSnapshot.userId, userId)));

	if (!snapshot) {
		return json({ error: 'Snapshot not found' }, { status: 404 });
	}

	// Get cluster name
	const [cluster] = await db
		.select({ name: billClusters.name })
		.from(billClusters)
		.where(eq(billClusters.id, snapshot.clusterId));

	return json({
		success: true,
		snapshot: {
			id: snapshot.id,
			clusterId: snapshot.clusterId,
			clusterName: cluster?.name || '',
			nComponents: snapshot.nComponents,
			name: snapshot.name,
			globalScores: JSON.parse(snapshot.globalScoresJson),
			clusterResults: JSON.parse(snapshot.clusterResultsJson),
			totalAnswered: snapshot.totalAnswered,
			createdAt: snapshot.createdAt.toISOString()
		}
	});
}

/**
 * Get user's bill answers, optionally filtered by cluster
 */
async function getAnswers(userId: string, clusterId: number | null) {
	let billIds: number[] | null = null;

	if (clusterId) {
		const assignments = await db
			.select({ billId: billClusterAssignments.billId })
			.from(billClusterAssignments)
			.where(eq(billClusterAssignments.clusterId, clusterId));
		billIds = assignments.map((a) => a.billId);
	}

	const answers =
		billIds !== null && billIds.length === 0
			? []
			: await db
					.select({
						billId: userBillAnswer.billId,
						score: userBillAnswer.score
					})
					.from(userBillAnswer)
					.where(
						billIds
							? and(eq(userBillAnswer.userId, userId), inArray(userBillAnswer.billId, billIds))
							: eq(userBillAnswer.userId, userId)
					);

	// Get bill titles
	const answeredBillIds = answers.map((a) => a.billId);
	const billTitles =
		answeredBillIds.length > 0
			? await db
					.select({ id: bill.id, title: bill.title })
					.from(bill)
					.where(inArray(bill.id, answeredBillIds))
			: [];
	const billTitleMap = new Map(billTitles.map((b) => [b.id, b.title || '']));

	return json({
		success: true,
		totalAnswers: answers.length,
		answers: answers.map((a) => ({
			billId: a.billId,
			title: billTitleMap.get(a.billId) || '',
			answer: a.score
		}))
	});
}

/**
 * POST /api/saved-sessions
 *
 * Actions:
 * - action: "snapshot" - Create a new snapshot
 * - action: "delete" - Delete a snapshot
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const body = await request.json();
		const { action } = body;

		switch (action) {
			case 'snapshot':
				return await handleSnapshot(body, locals.user.id);

			case 'delete':
				return await handleDelete(body, locals.user.id);

			default:
				return json({ error: 'Invalid action' }, { status: 400 });
		}
	} catch (error) {
		console.error('Saved sessions API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

/**
 * Create a new snapshot from current matching results
 */
async function handleSnapshot(
	body: {
		name: string;
		clusterId: number;
		nComponents: number;
		clusterResults: Array<{
			clusterLabel: number;
			clusterLabelName: string | null;
			importance: number;
			answeredCount: number;
			matches: Array<{
				memberId: number;
				name: string;
				group: string | null;
				similarity: number;
			}>;
			answeredBills?: Array<{ billId: number; title: string; answer: number }>;
		}>;
	},
	userId: string
) {
	const { name, clusterId, nComponents, clusterResults } = body;

	// Calculate global scores
	const globalScores = calculateGlobalScores(clusterResults);

	// Build cluster results data
	const clusterResultsData = clusterResults.map((cr) => ({
		clusterLabel: cr.clusterLabel,
		clusterLabelName: cr.clusterLabelName,
		answeredCount: cr.answeredCount,
		importance: cr.importance,
		matches: cr.matches.map((m) => ({
			memberId: m.memberId,
			name: m.name,
			group: m.group,
			similarity: m.similarity
		})),
		answeredBills: cr.answeredBills || []
	}));

	const totalAnswered = clusterResults.reduce((sum, cr) => sum + cr.answeredCount, 0);

	const [inserted] = await db
		.insert(resultSnapshot)
		.values({
			userId,
			clusterId,
			nComponents,
			name: name || `スナップショット ${new Date().toLocaleDateString('ja-JP')}`,
			globalScoresJson: JSON.stringify(globalScores),
			clusterResultsJson: JSON.stringify(clusterResultsData),
			totalAnswered
		})
		.returning({ id: resultSnapshot.id });

	return json({
		success: true,
		snapshotId: inserted.id
	});
}

/**
 * Delete a snapshot
 */
async function handleDelete(body: { snapshotId: number }, userId: string) {
	const { snapshotId } = body;

	await db
		.delete(resultSnapshot)
		.where(and(eq(resultSnapshot.id, snapshotId), eq(resultSnapshot.userId, userId)));

	return json({ success: true });
}

/**
 * Calculate global weighted scores from cluster results
 */
function calculateGlobalScores(
	clusterResults: Array<{
		clusterLabel: number;
		importance: number;
		matches: Array<{ memberId: number; name: string; group: string | null; similarity: number }>;
	}>
): GlobalMemberScore[] {
	const allMemberIds = new Set<number>();
	for (const result of clusterResults) {
		for (const match of result.matches) {
			allMemberIds.add(match.memberId);
		}
	}

	const totalWeight = clusterResults.reduce((sum, r) => sum + r.importance, 0);
	const memberScores: GlobalMemberScore[] = [];

	for (const memberId of allMemberIds) {
		let weightedSum = 0;
		const clusterScores: Record<number, number> = {};
		let memberName = '';
		let memberGroup: string | null = null;

		for (const result of clusterResults) {
			const match = result.matches.find((m) => m.memberId === memberId);
			if (match) {
				const similarity = match.similarity;
				clusterScores[result.clusterLabel] = similarity;
				weightedSum += (result.importance / totalWeight) * similarity;
				memberName = match.name;
				memberGroup = match.group;
			} else {
				clusterScores[result.clusterLabel] = 0;
			}
		}

		if (memberName) {
			memberScores.push({
				memberId,
				name: memberName,
				group: memberGroup,
				globalScore: weightedSum,
				clusterScores
			});
		}
	}

	return memberScores.sort((a, b) => b.globalScore - a.globalScore);
}
