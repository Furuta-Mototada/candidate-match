import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import {
	savedMatchingSession,
	sessionClusterResult,
	resultSnapshot,
	clusterVectorResults,
	userBillAnswer,
	billClusterAssignments,
	bill
} from '$lib/server/db/schema.js';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import type {
	SavedSessionListItem,
	SavedSessionWithDetails,
	GlobalMemberScore
} from '$lib/types/index.js';

/**
 * GET /api/saved-sessions
 *
 * Get saved matching sessions for the current user
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const sessionId = url.searchParams.get('id');

		if (sessionId) {
			// Get specific session with full details (verify ownership)
			return await getSessionDetails(parseInt(sessionId), locals.user.id);
		}

		// Get all sessions for this user with summary info
		const sessions = await db
			.select({
				id: savedMatchingSession.id,
				name: savedMatchingSession.name,
				description: savedMatchingSession.description,
				clusterId: savedMatchingSession.clusterId,
				nComponents: savedMatchingSession.nComponents,
				status: savedMatchingSession.status,
				createdAt: savedMatchingSession.createdAt,
				updatedAt: savedMatchingSession.updatedAt
			})
			.from(savedMatchingSession)
			.where(eq(savedMatchingSession.userId, locals.user.id))
			.orderBy(desc(savedMatchingSession.updatedAt));

		// Enrich with cluster results and snapshot info
		const sessionsWithDetails: SavedSessionListItem[] = await Promise.all(
			sessions.map(async (session) => {
				// Get cluster results for this session
				const clusterResults = await db
					.select({
						id: sessionClusterResult.id,
						clusterLabel: sessionClusterResult.clusterLabel,
						answeredCount: sessionClusterResult.answeredCount
					})
					.from(sessionClusterResult)
					.where(eq(sessionClusterResult.sessionId, session.id));

				// Get total bills from saved vector
				const savedVectors = await db
					.select({ billCount: clusterVectorResults.billCount })
					.from(clusterVectorResults)
					.where(eq(clusterVectorResults.clusterId, session.clusterId));

				const totalBills = savedVectors.reduce((sum, v) => sum + v.billCount, 0);
				const totalAnswered = clusterResults.reduce((sum, cr) => sum + cr.answeredCount, 0);

				// Get latest snapshot date
				const [latestSnapshot] = await db
					.select({ createdAt: resultSnapshot.createdAt })
					.from(resultSnapshot)
					.where(eq(resultSnapshot.sessionId, session.id))
					.orderBy(desc(resultSnapshot.snapshotNumber))
					.limit(1);

				return {
					id: session.id,
					name: session.name,
					description: session.description,
					status: session.status as 'in_progress' | 'completed',
					totalAnswered,
					totalBills,
					clusterCount: clusterResults.length,
					latestSnapshotDate: latestSnapshot?.createdAt?.toISOString() || null,
					createdAt: session.createdAt.toISOString(),
					updatedAt: session.updatedAt.toISOString()
				};
			})
		);

		return json({
			success: true,
			sessions: sessionsWithDetails
		});
	} catch (error) {
		console.error('Error fetching saved sessions:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

/**
 * Get detailed session info including all cluster results and snapshots
 */
async function getSessionDetails(sessionId: number, userId: string) {
	const [session] = await db
		.select()
		.from(savedMatchingSession)
		.where(and(eq(savedMatchingSession.id, sessionId), eq(savedMatchingSession.userId, userId)));

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Get cluster results
	const clusterResults = await db
		.select()
		.from(sessionClusterResult)
		.where(eq(sessionClusterResult.sessionId, sessionId))
		.orderBy(sessionClusterResult.clusterLabel);

	// Get all bill assignments for this session's cluster to map bills to cluster labels
	const clusterAssignments = await db
		.select({
			billId: billClusterAssignments.billId,
			clusterLabel: billClusterAssignments.clusterLabel
		})
		.from(billClusterAssignments)
		.where(eq(billClusterAssignments.clusterId, session.clusterId));

	// Build a map of clusterLabel -> billIds
	const clusterBillMap = new Map<number, number[]>();
	for (const a of clusterAssignments) {
		const bills = clusterBillMap.get(a.clusterLabel) || [];
		bills.push(a.billId);
		clusterBillMap.set(a.clusterLabel, bills);
	}

	// Get all user answers for bills in this cluster
	const allBillIds = clusterAssignments.map((a) => a.billId);
	const userAnswers =
		allBillIds.length > 0
			? await db
					.select({
						billId: userBillAnswer.billId,
						score: userBillAnswer.score
					})
					.from(userBillAnswer)
					.where(and(eq(userBillAnswer.userId, userId), inArray(userBillAnswer.billId, allBillIds)))
			: [];

	// Get bill titles for answered bills
	const answeredBillIds = userAnswers.map((a) => a.billId);
	const billTitles =
		answeredBillIds.length > 0
			? await db
					.select({ id: bill.id, title: bill.title })
					.from(bill)
					.where(inArray(bill.id, answeredBillIds))
			: [];
	const billTitleMap = new Map(billTitles.map((b) => [b.id, b.title || '']));

	// Build a map of billId -> answer
	const answerMap = new Map(userAnswers.map((a) => [a.billId, a.score]));

	// Build answers per cluster result
	const clusterResultsWithAnswers = clusterResults.map((cr) => {
		const billIdsInCluster = clusterBillMap.get(cr.clusterLabel) || [];
		const answersForCluster = billIdsInCluster
			.filter((bId) => answerMap.has(bId))
			.map((bId) => ({
				billId: bId,
				title: billTitleMap.get(bId) || '',
				answer: answerMap.get(bId)!
			}));

		return {
			id: cr.id,
			sessionId: cr.sessionId,
			clusterLabel: cr.clusterLabel,
			clusterLabelName: cr.clusterLabelName,
			userVector: JSON.parse(cr.userVector),
			importance: cr.importance,
			answeredCount: answersForCluster.length,
			matches: JSON.parse(cr.matchesJson),
			memberVectorsForViz: cr.memberVectorsVizJson
				? JSON.parse(cr.memberVectorsVizJson)
				: undefined,
			explainedVariance: cr.explainedVarianceJson
				? JSON.parse(cr.explainedVarianceJson)
				: undefined,
			userVectorHistory: cr.userVectorHistoryJson
				? JSON.parse(cr.userVectorHistoryJson)
				: undefined,
			xDimension: cr.xDimension ?? 0,
			yDimension: cr.yDimension ?? 1,
			answeredBills: answersForCluster,
			createdAt: cr.createdAt.toISOString(),
			updatedAt: cr.updatedAt.toISOString()
		};
	});

	// Get snapshots
	const snapshots = await db
		.select()
		.from(resultSnapshot)
		.where(eq(resultSnapshot.sessionId, sessionId))
		.orderBy(desc(resultSnapshot.snapshotNumber));

	const snapshotsData = snapshots.map((s) => ({
		id: s.id,
		sessionId: s.sessionId,
		snapshotNumber: s.snapshotNumber,
		name: s.name,
		globalScores: JSON.parse(s.globalScoresJson),
		clusterResults: JSON.parse(s.clusterResultsJson),
		totalAnswered: s.totalAnswered,
		createdAt: s.createdAt.toISOString()
	}));

	// Calculate global scores if session is completed or has results
	let globalScores: GlobalMemberScore[] | undefined;
	if (clusterResultsWithAnswers.length > 0) {
		globalScores = calculateGlobalScores(clusterResultsWithAnswers);
	}

	// Get total bills from saved vectors
	const savedVectors = await db
		.select({ billCount: clusterVectorResults.billCount })
		.from(clusterVectorResults)
		.where(eq(clusterVectorResults.clusterId, session.clusterId));

	const totalBills = savedVectors.reduce((sum, v) => sum + v.billCount, 0);
	const totalAnswered = clusterResultsWithAnswers.reduce((sum, cr) => sum + cr.answeredCount, 0);

	const sessionWithDetails: SavedSessionWithDetails = {
		...session,
		createdAt: session.createdAt.toISOString(),
		updatedAt: session.updatedAt.toISOString(),
		status: session.status as 'in_progress' | 'completed',
		clusterResults: clusterResultsWithAnswers,
		snapshots: snapshotsData,
		totalAnswered,
		totalBills,
		globalScores
	};

	return json({
		success: true,
		session: sessionWithDetails
	});
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

/**
 * POST /api/saved-sessions
 *
 * Actions:
 * - action: "save" - Save a new or update existing session
 * - action: "snapshot" - Create a new snapshot for a session
 * - action: "delete" - Delete a session
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required to save sessions' }, { status: 401 });
		}

		const body = await request.json();
		const { action } = body;

		switch (action) {
			case 'save':
				return await handleSave(body, locals.user.id);

			case 'snapshot':
				return await handleSnapshot(body);

			case 'delete':
				return await handleDelete(body, locals.user.id);

			case 'update-importance':
				return await handleUpdateImportance(body);

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
 * Save a new session or update existing one
 */
async function handleSave(
	body: {
		sessionId?: number;
		name: string;
		description?: string;
		clusterId: number;
		nComponents: number;
		status: string;
		clusterResults: Array<{
			clusterLabel: number;
			clusterLabelName: string | null;
			userVector: number[];
			importance: number;
			answeredCount: number;
			matches: Array<{
				memberId: number;
				name: string;
				group: string | null;
				similarity: number;
				rank: number;
			}>;
			memberVectorsForViz?: Array<{
				memberId: number;
				name: string;
				group: string | null;
				latentVector: number[];
			}>;
			explainedVariance?: number[];
			userVectorHistory?: number[][];
			xDimension?: number;
			yDimension?: number;
			answeredBills: Array<{ billId: number; title: string; answer: number }>;
		}>;
		createSnapshot?: boolean;
	},
	userId: string
) {
	const {
		sessionId,
		name,
		description,
		clusterId,
		nComponents,
		status,
		clusterResults,
		createSnapshot = true
	} = body;

	let finalSessionId: number;

	if (sessionId) {
		// Update existing session - only update name/description if provided
		const updateFields: Record<string, unknown> = {
			status,
			updatedAt: sql`now()`
		};

		if (name && name.trim()) {
			updateFields.name = name;
		}
		if (description !== undefined && description !== null) {
			updateFields.description = description;
		}

		await db
			.update(savedMatchingSession)
			.set(updateFields)
			.where(eq(savedMatchingSession.id, sessionId));

		finalSessionId = sessionId;

		// Delete existing cluster results to replace them
		await db.delete(sessionClusterResult).where(eq(sessionClusterResult.sessionId, sessionId));
	} else {
		// Create new session
		const [newSession] = await db
			.insert(savedMatchingSession)
			.values({
				userId,
				name,
				description,
				clusterId,
				nComponents,
				status
			})
			.returning({ id: savedMatchingSession.id });

		finalSessionId = newSession.id;
	}

	// Insert cluster results
	for (const cr of clusterResults) {
		await db.insert(sessionClusterResult).values({
			sessionId: finalSessionId,
			clusterLabel: cr.clusterLabel,
			clusterLabelName: cr.clusterLabelName,
			userVector: JSON.stringify(cr.userVector),
			importance: cr.importance,
			answeredCount: cr.answeredCount,
			matchesJson: JSON.stringify(cr.matches),
			memberVectorsVizJson: cr.memberVectorsForViz ? JSON.stringify(cr.memberVectorsForViz) : null,
			explainedVarianceJson: cr.explainedVariance ? JSON.stringify(cr.explainedVariance) : null,
			userVectorHistoryJson: cr.userVectorHistory ? JSON.stringify(cr.userVectorHistory) : null,
			xDimension: cr.xDimension ?? 0,
			yDimension: cr.yDimension ?? 1
		});

		// Persist bill answers to user_bill_answer (upsert)
		if (cr.answeredBills && cr.answeredBills.length > 0) {
			for (const ab of cr.answeredBills) {
				await db
					.insert(userBillAnswer)
					.values({
						userId,
						billId: ab.billId,
						score: ab.answer
					})
					.onConflictDoUpdate({
						target: [userBillAnswer.userId, userBillAnswer.billId],
						set: {
							score: ab.answer,
							updatedAt: sql`now()`
						}
					});
			}
		}
	}

	// Create snapshot if requested
	if (createSnapshot && status === 'completed') {
		await createNewSnapshot(finalSessionId, clusterResults);
	}

	return json({
		success: true,
		sessionId: finalSessionId
	});
}

/**
 * Create a new snapshot for a session
 */
async function handleSnapshot(body: { sessionId: number; name?: string }) {
	const { sessionId, name } = body;

	// Get current cluster results
	const clusterResults = await db
		.select()
		.from(sessionClusterResult)
		.where(eq(sessionClusterResult.sessionId, sessionId));

	if (clusterResults.length === 0) {
		return json({ error: 'No cluster results found for session' }, { status: 400 });
	}

	// Get the session to find userId and clusterId
	const [sessionData] = await db
		.select()
		.from(savedMatchingSession)
		.where(eq(savedMatchingSession.id, sessionId));

	if (!sessionData) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Get cluster assignments to map bills to cluster labels
	const clusterAssignments = await db
		.select({
			billId: billClusterAssignments.billId,
			clusterLabel: billClusterAssignments.clusterLabel
		})
		.from(billClusterAssignments)
		.where(eq(billClusterAssignments.clusterId, sessionData.clusterId));

	const clusterBillMap = new Map<number, number[]>();
	for (const a of clusterAssignments) {
		const bills = clusterBillMap.get(a.clusterLabel) || [];
		bills.push(a.billId);
		clusterBillMap.set(a.clusterLabel, bills);
	}

	// Get all user answers
	const allBillIds = clusterAssignments.map((a) => a.billId);
	const userAnswers =
		allBillIds.length > 0
			? await db
					.select({
						billId: userBillAnswer.billId,
						score: userBillAnswer.score
					})
					.from(userBillAnswer)
					.where(
						and(
							eq(userBillAnswer.userId, sessionData.userId),
							inArray(userBillAnswer.billId, allBillIds)
						)
					)
			: [];

	const answerMap = new Map(userAnswers.map((a) => [a.billId, a.score]));

	// Get bill titles
	const answeredBillIds = userAnswers.map((a) => a.billId);
	const billTitles =
		answeredBillIds.length > 0
			? await db
					.select({ id: bill.id, title: bill.title })
					.from(bill)
					.where(inArray(bill.id, answeredBillIds))
			: [];
	const billTitleMap = new Map(billTitles.map((b) => [b.id, b.title || '']));

	// Build results for snapshot
	const resultsForSnapshot = clusterResults.map((cr) => {
		const billIdsInCluster = clusterBillMap.get(cr.clusterLabel) || [];
		const answersForCluster = billIdsInCluster
			.filter((bId) => answerMap.has(bId))
			.map((bId) => ({
				billId: bId,
				title: billTitleMap.get(bId) || '',
				answer: answerMap.get(bId)!
			}));

		return {
			clusterLabel: cr.clusterLabel,
			clusterLabelName: cr.clusterLabelName,
			importance: cr.importance,
			answeredCount: answersForCluster.length,
			matches: JSON.parse(cr.matchesJson),
			answeredBills: answersForCluster
		};
	});

	const snapshotId = await createNewSnapshot(sessionId, resultsForSnapshot, name);

	return json({
		success: true,
		snapshotId
	});
}

/**
 * Create a new snapshot
 */
async function createNewSnapshot(
	sessionId: number,
	clusterResults: Array<{
		clusterLabel: number;
		clusterLabelName: string | null;
		importance: number;
		answeredCount: number;
		matches: Array<{ memberId: number; name: string; group: string | null; similarity: number }>;
		answeredBills?: Array<{ billId: number; title: string; answer: number }>;
	}>,
	name?: string
): Promise<number> {
	// Get next snapshot number
	const [lastSnapshot] = await db
		.select({ snapshotNumber: resultSnapshot.snapshotNumber })
		.from(resultSnapshot)
		.where(eq(resultSnapshot.sessionId, sessionId))
		.orderBy(desc(resultSnapshot.snapshotNumber))
		.limit(1);

	const nextNumber = (lastSnapshot?.snapshotNumber ?? 0) + 1;

	// Calculate global scores
	const globalScores = calculateGlobalScores(clusterResults);

	// Create cluster result data with ALL matches and answeredBills for detailed viewing
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
			sessionId,
			snapshotNumber: nextNumber,
			name: name || `スナップショット ${nextNumber}`,
			globalScoresJson: JSON.stringify(globalScores),
			clusterResultsJson: JSON.stringify(clusterResultsData),
			totalAnswered
		})
		.returning({ id: resultSnapshot.id });

	return inserted.id;
}

/**
 * Delete a session
 */
async function handleDelete(body: { sessionId: number }, userId: string) {
	const { sessionId } = body;

	// Only delete if owned by user
	await db
		.delete(savedMatchingSession)
		.where(and(eq(savedMatchingSession.id, sessionId), eq(savedMatchingSession.userId, userId)));

	return json({ success: true });
}

/**
 * Update importance for a cluster result
 */
async function handleUpdateImportance(body: {
	sessionId: number;
	clusterLabel: number;
	importance: number;
}) {
	const { sessionId, clusterLabel, importance } = body;

	await db
		.update(sessionClusterResult)
		.set({
			importance,
			updatedAt: sql`now()`
		})
		.where(
			and(
				eq(sessionClusterResult.sessionId, sessionId),
				eq(sessionClusterResult.clusterLabel, clusterLabel)
			)
		);

	// Update session updatedAt
	await db
		.update(savedMatchingSession)
		.set({ updatedAt: sql`now()` })
		.where(eq(savedMatchingSession.id, sessionId));

	return json({ success: true });
}
