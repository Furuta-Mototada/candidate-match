import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '$lib/server/db';
import { billClusters, billClusterAssignments, member } from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';
import {
	initializeMatchingState,
	updateMatchingState,
	selectNextQuestion,
	findMatchingMembers,
	loadBillInfo,
	loadMemberGroups,
	buildBillInfoMap,
	type MatchingState,
	type UserAnswer,
	type ClusterVectorData,
	type MatchResult
} from '$lib/server/matching';

const execAsync = promisify(exec);

// In-memory session store (in production, use Redis or database)
const sessions = new Map<
	string,
	{
		state: MatchingState;
		clusterData: ClusterVectorData;
		billInfoMap: Map<
			number,
			{
				billId: number;
				title: string;
				description: string | null;
				passed: boolean;
				loading: number[];
				memberVariance: number;
			}
		>;
		createdAt: Date;
	}
>();

// Clean up old sessions (older than 1 hour)
function cleanupSessions() {
	const now = new Date();
	for (const [sessionId, session] of sessions.entries()) {
		if (now.getTime() - session.createdAt.getTime() > 60 * 60 * 1000) {
			sessions.delete(sessionId);
		}
	}
}

// Run cleanup every 10 minutes
setInterval(cleanupSessions, 10 * 60 * 1000);

/**
 * POST /api/match
 *
 * Actions:
 * - action: "start" - Start a new matching session
 * - action: "answer" - Submit an answer and get next question
 * - action: "results" - Get current matching results
 * - action: "skip" - Skip current question and get next
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { action, sessionId, clusterId, clusterLabel, nComponents, billId, score } = body;

		switch (action) {
			case 'start':
				return await handleStart(clusterId, clusterLabel, nComponents);

			case 'answer':
				return await handleAnswer(sessionId, billId, score);

			case 'skip':
				return await handleSkip(sessionId, billId);

			case 'results':
				return await handleResults(sessionId);

			default:
				return json({ error: 'Invalid action' }, { status: 400 });
		}
	} catch (error) {
		console.error('Match API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

/**
 * Start a new matching session
 */
async function handleStart(
	clusterId: number,
	clusterLabel: number | null,
	nComponents: number = 3
) {
	if (!clusterId) {
		return json({ error: 'clusterId is required' }, { status: 400 });
	}

	// Verify cluster exists
	const [clusterInfo] = await db.select().from(billClusters).where(eq(billClusters.id, clusterId));

	if (!clusterInfo) {
		return json({ error: 'Cluster not found' }, { status: 404 });
	}

	// Calculate cluster vectors using Python script
	let cmd = `source venv/bin/activate && python scripts/calculate_cluster_vectors.py --cluster-id ${clusterId} --n-components ${nComponents}`;
	if (clusterLabel !== null && clusterLabel !== undefined) {
		cmd += ` --cluster-label ${clusterLabel}`;
	}

	console.log(`Executing: ${cmd}`);

	const { stdout, stderr } = await execAsync(cmd, {
		cwd: process.cwd(),
		env: process.env,
		shell: '/bin/zsh',
		maxBuffer: 50 * 1024 * 1024
	});

	if (stderr) {
		console.log('Cluster vector calculation stderr:', stderr);
	}

	// Parse JSON output
	const lines = stdout.trim().split('\n');
	let jsonOutput = '';
	let inJson = false;
	for (const line of lines) {
		if (line.startsWith('{')) inJson = true;
		if (inJson) jsonOutput += line;
	}

	if (!jsonOutput) {
		throw new Error('No JSON output from calculation script');
	}

	const result = JSON.parse(jsonOutput);

	// Get the first cluster if no specific label was provided
	const clusterLabels = Object.keys(result.clusters);
	if (clusterLabels.length === 0) {
		return json({ error: 'No clusters found' }, { status: 404 });
	}

	const selectedLabel = clusterLabel !== null ? String(clusterLabel) : clusterLabels[0];
	const clusterData: ClusterVectorData = result.clusters[selectedLabel];

	if (!clusterData) {
		return json({ error: 'Cluster label not found' }, { status: 404 });
	}

	// Enrich with member names
	const memberIds = Object.keys(clusterData.memberVectors).map((id) => parseInt(id));
	const members =
		memberIds.length > 0 ? await db.select().from(member).where(inArray(member.id, memberIds)) : [];

	clusterData.memberNames = {};
	for (const m of members) {
		clusterData.memberNames[String(m.id)] = m.name;
	}

	// Load bill information from database
	const dbBillInfo = await loadBillInfo(clusterData.billIds);
	const billInfoMap = buildBillInfoMap(clusterData, dbBillInfo);

	// Initialize matching state
	const state = initializeMatchingState(clusterId, parseInt(selectedLabel), clusterData.dimensions);

	// Generate session ID
	const sessionIdValue = crypto.randomUUID();

	// Store session
	sessions.set(sessionIdValue, {
		state,
		clusterData,
		billInfoMap,
		createdAt: new Date()
	});

	// Get first question
	const nextQuestion = selectNextQuestion(state, clusterData, billInfoMap);

	return json({
		success: true,
		sessionId: sessionIdValue,
		clusterId,
		clusterLabel: parseInt(selectedLabel),
		clusterName: clusterInfo.name,
		dimensions: clusterData.dimensions,
		totalBills: clusterData.billCount,
		totalMembers: clusterData.memberCount,
		questionCount: 0,
		nextQuestion: nextQuestion
			? {
					billId: nextQuestion.bill.billId,
					title: nextQuestion.bill.title,
					description: nextQuestion.bill.description,
					passed: nextQuestion.bill.passed,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget
				}
			: null,
		uncertainty: state.uncertainty,
		userVector: state.userVector
	});
}

/**
 * Handle user answer and return next question
 */
async function handleAnswer(sessionId: string, billId: number, score: number) {
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = sessions.get(sessionId);
	if (!session) {
		return json({ error: 'Session not found or expired' }, { status: 404 });
	}

	if (billId === undefined || score === undefined) {
		return json({ error: 'billId and score are required' }, { status: 400 });
	}

	// Validate score is in range [-1, 1]
	const normalizedScore = Math.max(-1, Math.min(1, score));

	// Create answer
	const answer: UserAnswer = { billId, score: normalizedScore };

	// Build bill loadings map
	const billLoadingsMap = new Map<number, number[]>();
	for (let i = 0; i < session.clusterData.billIds.length; i++) {
		billLoadingsMap.set(session.clusterData.billIds[i], session.clusterData.billLoadings[i]);
	}

	// Update state
	const newState = updateMatchingState(session.state, answer, billLoadingsMap);
	session.state = newState;

	// Get next question
	const nextQuestion = selectNextQuestion(newState, session.clusterData, session.billInfoMap);

	// Get current top matches
	const matches = findMatchingMembers(newState.userVector, session.clusterData, 10);

	// Enrich matches with group info
	const memberIds = matches.map((m: MatchResult) => m.member.memberId);
	const groupMap = await loadMemberGroups(memberIds);
	for (const match of matches) {
		match.member.group = groupMap.get(match.member.memberId) || null;
	}

	return json({
		success: true,
		questionCount: newState.questionCount,
		answeredBills: newState.answeredBills.length,
		nextQuestion: nextQuestion
			? {
					billId: nextQuestion.bill.billId,
					title: nextQuestion.bill.title,
					description: nextQuestion.bill.description,
					passed: nextQuestion.bill.passed,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget
				}
			: null,
		uncertainty: newState.uncertainty,
		userVector: newState.userVector,
		topMatches: matches.slice(0, 5).map((m: MatchResult) => ({
			memberId: m.member.memberId,
			name: m.member.name,
			group: m.member.group,
			similarity: m.similarity,
			rank: m.rank
		})),
		isComplete: nextQuestion === null
	});
}

/**
 * Skip a question and get next
 */
async function handleSkip(sessionId: string, billId: number) {
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = sessions.get(sessionId);
	if (!session) {
		return json({ error: 'Session not found or expired' }, { status: 404 });
	}

	// Add bill to answered with score 0 (neutral/skip)
	const answer: UserAnswer = { billId, score: 0 };

	// Build bill loadings map
	const billLoadingsMap = new Map<number, number[]>();
	for (let i = 0; i < session.clusterData.billIds.length; i++) {
		billLoadingsMap.set(session.clusterData.billIds[i], session.clusterData.billLoadings[i]);
	}

	// Update state (skip counts as neutral answer for tracking purposes)
	const newState = updateMatchingState(session.state, answer, billLoadingsMap);
	session.state = newState;

	// Get next question
	const nextQuestion = selectNextQuestion(newState, session.clusterData, session.billInfoMap);

	return json({
		success: true,
		questionCount: newState.questionCount,
		nextQuestion: nextQuestion
			? {
					billId: nextQuestion.bill.billId,
					title: nextQuestion.bill.title,
					description: nextQuestion.bill.description,
					passed: nextQuestion.bill.passed,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget
				}
			: null,
		uncertainty: newState.uncertainty,
		isComplete: nextQuestion === null
	});
}

/**
 * Get full matching results
 */
async function handleResults(sessionId: string) {
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = sessions.get(sessionId);
	if (!session) {
		return json({ error: 'Session not found or expired' }, { status: 404 });
	}

	const { state, clusterData } = session;

	// Get all matches
	const matches = findMatchingMembers(state.userVector, clusterData, 50);

	// Enrich with group info
	const memberIds = matches.map((m: MatchResult) => m.member.memberId);
	const groupMap = await loadMemberGroups(memberIds);
	for (const match of matches) {
		match.member.group = groupMap.get(match.member.memberId) || null;
	}

	return json({
		success: true,
		questionCount: state.questionCount,
		answeredBills: state.answeredBills,
		userVector: state.userVector,
		uncertainty: state.uncertainty,
		matches: matches.map((m: MatchResult) => ({
			memberId: m.member.memberId,
			name: m.member.name,
			group: m.member.group,
			similarity: m.similarity,
			rank: m.rank,
			latentVector: m.member.latentVector
		})),
		dimensions: state.dimensions,
		clusterLabel: state.clusterLabel
	});
}

/**
 * GET /api/match
 *
 * Get available clusters for matching
 */
export const GET: RequestHandler = async () => {
	try {
		const clusters = await db
			.select({
				id: billClusters.id,
				name: billClusters.name,
				algorithm: billClusters.algorithm,
				parameters: billClusters.parameters,
				createdAt: billClusters.createdAt
			})
			.from(billClusters);

		// Get cluster labels for each cluster
		const clustersWithLabels = await Promise.all(
			clusters.map(
				async (cluster: {
					id: number;
					name: string;
					algorithm: string;
					parameters: Record<string, unknown> | null;
					createdAt: Date;
				}) => {
					const assignments = await db
						.select({ clusterLabel: billClusterAssignments.clusterLabel })
						.from(billClusterAssignments)
						.where(eq(billClusterAssignments.clusterId, cluster.id));

					const labelCounts: Record<number, number> = {};
					for (const a of assignments) {
						labelCounts[a.clusterLabel] = (labelCounts[a.clusterLabel] || 0) + 1;
					}

					const labels = Object.entries(labelCounts)
						.map(([label, count]) => ({
							label: parseInt(label),
							billCount: count
						}))
						.sort((a, b) => a.label - b.label);

					return {
						...cluster,
						labels
					};
				}
			)
		);

		return json({
			success: true,
			clusters: clustersWithLabels
		});
	} catch (error) {
		console.error('Error fetching clusters:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
