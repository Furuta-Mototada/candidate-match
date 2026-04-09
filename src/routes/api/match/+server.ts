import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '$lib/server/db/index.js';
import {
	billClusters,
	billClusterAssignments,
	clusterVectorResults,
	billClusterLabelNames,
	member,
	userBillAnswer,
	voteDelegation,
	bill as billTable,
	user as userTable
} from '$lib/server/db/schema.js';
import { eq, inArray, desc, and, sql } from 'drizzle-orm';
import {
	initializeMatchingState,
	updateMatchingState,
	selectNextQuestion,
	findMatchingMembers,
	loadBillInfo,
	loadMemberGroups,
	buildBillInfoMap,
	answerToScore,
	scoreToAnswer,
	type MatchingState,
	type UserAnswer,
	type ClusterVectorData,
	type MatchResult
} from '$lib/server/matching.js';
import {
	notifyDelegationOverridden,
	notifyDelegationVoteChanged,
	notifyUpstreamDelegatorsVoteChanged
} from '$lib/server/notifications.js';
import { resolveDelegatedVotes } from '$lib/server/delegation-helpers.js';

const execAsync = promisify(exec);

type SessionData = {
	state: MatchingState;
	clusterData: ClusterVectorData;
	billInfoMap: Map<
		number,
		{
			billId: number;
			title: string;
			description: string | null;
			passed: boolean;
			result: string | null;
			loading: number[];
			memberVariance: number;
		}
	>;
	createdAt: Date;
};

// In-memory session store (used as cache; sessions are reconstructed from DB on miss)
const sessions = new Map<string, SessionData>();

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
 * Reconstruct a session from saved vector data + client-provided state.
 * This is the fallback for serverless environments where in-memory sessions are lost.
 */
async function reconstructSession(
	savedVectorId: number,
	clientUserVector: number[],
	clientAnsweredBills: { billId: number; score: number }[]
): Promise<SessionData | null> {
	const [savedResult] = await db
		.select()
		.from(clusterVectorResults)
		.where(eq(clusterVectorResults.id, savedVectorId));

	if (!savedResult) return null;

	const clusterData: ClusterVectorData = {
		memberVectors: JSON.parse(savedResult.memberVectors),
		memberNames: JSON.parse(savedResult.memberNames),
		billLoadings: JSON.parse(savedResult.billLoadings),
		billIds: JSON.parse(savedResult.billIds),
		explainedVariance: JSON.parse(savedResult.explainedVariance),
		dimensions: savedResult.dimensions,
		memberCount: savedResult.memberCount,
		billCount: savedResult.billCount
	};

	const dbBillInfo = await loadBillInfo(clusterData.billIds);
	const billInfoMap = buildBillInfoMap(clusterData, dbBillInfo);

	// Initialize a fresh state and replay answers to get proper uncertainty
	const state = initializeMatchingState(
		savedResult.clusterId,
		savedResult.clusterLabel,
		clusterData.dimensions
	);

	if (clientAnsweredBills.length > 0) {
		const billLoadingsMap = new Map<number, number[]>();
		for (let i = 0; i < clusterData.billIds.length; i++) {
			billLoadingsMap.set(clusterData.billIds[i], clusterData.billLoadings[i]);
		}

		for (const ab of clientAnsweredBills) {
			const userAnswer: UserAnswer = { billId: ab.billId, score: ab.score };
			const newState = updateMatchingState(state, userAnswer, billLoadingsMap);
			state.userVector = newState.userVector;
			state.answeredBills = newState.answeredBills;
			state.questionCount = newState.questionCount;
			state.uncertainty = newState.uncertainty;
		}
	}

	const session: SessionData = {
		state,
		clusterData,
		billInfoMap,
		createdAt: new Date()
	};

	return session;
}

/**
 * Get session from memory or reconstruct from DB.
 * Returns the session if found/reconstructed, or null.
 */
async function getOrReconstructSession(
	sessionId: string | null,
	savedVectorId?: number,
	clientUserVector?: number[],
	clientAnsweredBills?: { billId: number; score: number }[]
): Promise<SessionData | null> {
	// Try in-memory first
	if (sessionId) {
		const session = sessions.get(sessionId);
		if (session) return session;
	}

	// Fallback: reconstruct from DB (essential for serverless environments like Vercel)
	if (savedVectorId) {
		console.log(
			`[session] Reconstructing session from savedVectorId=${savedVectorId} (in-memory miss, ${clientAnsweredBills?.length ?? 0} answered bills from client)`
		);
		const session = await reconstructSession(
			savedVectorId,
			clientUserVector || [],
			clientAnsweredBills || []
		);
		if (session && sessionId) {
			// Cache for subsequent requests in the same invocation
			sessions.set(sessionId, session);
		}
		return session;
	}

	return null;
}

/**
 * POST /api/match
 *
 * Actions:
 * - action: "start" - Start a new matching session (use savedVectorId to load pre-calculated vectors)
 * - action: "answer" - Submit an answer and get next question
 * - action: "results" - Get current matching results
 * - action: "skip" - Skip current question and get next
 */
export const POST: RequestHandler = async ({ request, locals }): Promise<Response> => {
	try {
		const body = await request.json();
		const {
			action,
			sessionId,
			clusterId,
			clusterLabel,
			nComponents,
			billId,
			score,
			savedVectorId,
			existingUserVector,
			answeredBillIds
		} = body;

		const userId = locals.user?.id || null;

		const clientUserVector = body.userVector;
		const clientAnsweredBills: { billId: number; score: number }[] | undefined = body.answeredBills;

		switch (action) {
			case 'start':
				return await handleStart(clusterId, clusterLabel, nComponents, savedVectorId, userId);

			case 'resume':
				return await handleResume(
					savedVectorId,
					existingUserVector,
					answeredBillIds,
					userId,
					clientAnsweredBills
				);

			case 'answer':
				return await handleAnswer(
					sessionId,
					billId,
					score,
					userId,
					savedVectorId,
					clientUserVector,
					clientAnsweredBills
				);

			case 'skip':
				return await handleSkip(
					sessionId,
					billId,
					userId,
					savedVectorId,
					clientUserVector,
					clientAnsweredBills
				);

			case 'results':
				return await handleResults(sessionId, savedVectorId, clientUserVector, clientAnsweredBills);

			case 'retract-answer':
				return await handleRetractAnswer(billId, userId);

			case 'direct-vote':
				return await handleDirectVote(billId, score, userId);

			case 'set-default': {
				if (!locals.user || locals.user.role !== 'admin') {
					return json({ error: 'Admin access required' }, { status: 403 });
				}
				const { name: configName, configClusterId } = body;
				if (!configName || configClusterId == null) {
					return json({ error: 'name and configClusterId are required' }, { status: 400 });
				}
				// Clear all existing defaults
				await db
					.update(clusterVectorResults)
					.set({ isDefault: false })
					.where(eq(clusterVectorResults.isDefault, true));
				// Set new default
				await db
					.update(clusterVectorResults)
					.set({ isDefault: true })
					.where(
						and(
							eq(clusterVectorResults.name, configName),
							eq(clusterVectorResults.clusterId, configClusterId)
						)
					);
				return json({ success: true });
			}

			case 'clear-default': {
				if (!locals.user || locals.user.role !== 'admin') {
					return json({ error: 'Admin access required' }, { status: 403 });
				}
				await db
					.update(clusterVectorResults)
					.set({ isDefault: false })
					.where(eq(clusterVectorResults.isDefault, true));
				return json({ success: true });
			}

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
 * If savedVectorId is provided, load pre-calculated vectors from the database
 * Otherwise, calculate vectors on the fly (deprecated, for backwards compatibility)
 */
async function handleStart(
	clusterId: number,
	clusterLabel: number | null,
	nComponents: number = 3,
	savedVectorId: number | null = null,
	userId: string | null = null
) {
	let clusterData: ClusterVectorData;
	let clusterInfo: { id: number; name: string };
	let selectedLabel: number;

	// If savedVectorId is provided, load from database
	if (savedVectorId) {
		const [savedResult] = await db
			.select()
			.from(clusterVectorResults)
			.where(eq(clusterVectorResults.id, savedVectorId));

		if (!savedResult) {
			return json({ error: 'Saved vector result not found' }, { status: 404 });
		}

		// Get cluster info
		const [cluster] = await db
			.select()
			.from(billClusters)
			.where(eq(billClusters.id, savedResult.clusterId));

		if (!cluster) {
			return json({ error: 'Cluster not found' }, { status: 404 });
		}

		clusterInfo = cluster;
		selectedLabel = savedResult.clusterLabel;

		// Parse the saved data
		clusterData = {
			memberVectors: JSON.parse(savedResult.memberVectors),
			memberNames: JSON.parse(savedResult.memberNames),
			billLoadings: JSON.parse(savedResult.billLoadings),
			billIds: JSON.parse(savedResult.billIds),
			explainedVariance: JSON.parse(savedResult.explainedVariance),
			dimensions: savedResult.dimensions,
			memberCount: savedResult.memberCount,
			billCount: savedResult.billCount
		};

		console.log(`Loaded saved vectors: ${savedResult.name} (ID: ${savedVectorId})`);
	} else {
		// Fallback: calculate on the fly (for backwards compatibility)
		if (!clusterId) {
			return json({ error: 'clusterId or savedVectorId is required' }, { status: 400 });
		}

		// Verify cluster exists
		const [cluster] = await db.select().from(billClusters).where(eq(billClusters.id, clusterId));

		if (!cluster) {
			return json({ error: 'Cluster not found' }, { status: 404 });
		}

		clusterInfo = cluster;

		// Calculate cluster vectors using Python script
		let cmd = `./venv/bin/python3 scripts/calculate_cluster_vectors.py --cluster-id ${clusterId} --n-components ${nComponents}`;
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

		const selectedLabelStr = clusterLabel !== null ? String(clusterLabel) : clusterLabels[0];
		clusterData = result.clusters[selectedLabelStr];
		selectedLabel = parseInt(selectedLabelStr);

		if (!clusterData) {
			return json({ error: 'Cluster label not found' }, { status: 404 });
		}

		// Enrich with member names
		const memberIds = Object.keys(clusterData.memberVectors).map((id) => parseInt(id));
		const members =
			memberIds.length > 0
				? await db.select().from(member).where(inArray(member.id, memberIds))
				: [];

		clusterData.memberNames = {};
		for (const m of members) {
			clusterData.memberNames[String(m.id)] = m.names[0]; // Use primary name
		}
	}

	// Load bill information from database
	const dbBillInfo = await loadBillInfo(clusterData.billIds);
	const billInfoMap = buildBillInfoMap(clusterData, dbBillInfo);

	// Initialize matching state
	const state = initializeMatchingState(
		savedVectorId ? clusterInfo.id : clusterId,
		selectedLabel,
		clusterData.dimensions
	);

	// Track source per bill for frontend response
	const billSourceMap = new Map<number, 'direct' | 'delegated'>();
	const delegationStatusMap = new Map<number, 'pending' | 'voted'>();
	const delegateIdMap = new Map<number, string>();

	// If user is logged in, pre-populate with existing bill answers
	if (userId) {
		const existingAnswers = await db
			.select()
			.from(userBillAnswer)
			.where(
				and(eq(userBillAnswer.userId, userId), inArray(userBillAnswer.billId, clusterData.billIds))
			);

		// Also resolve delegated votes for bills in this cluster
		const delegatedVotes = await resolveDelegatedVotes(userId, clusterData.billIds);

		// Find bills with active (non-rejected) outgoing delegations (includes pending/voted/redelegated)
		const activeDelegations = await db
			.select({ billId: voteDelegation.billId, delegateId: voteDelegation.delegateId })
			.from(voteDelegation)
			.where(
				and(
					eq(voteDelegation.delegatorId, userId),
					inArray(voteDelegation.billId, clusterData.billIds),
					sql`${voteDelegation.status} != 'rejected'`
				)
			);
		const delegatedBillIds = new Set(activeDelegations.map((d) => d.billId));
		for (const d of activeDelegations) {
			delegateIdMap.set(d.billId, d.delegateId);
		}

		console.log(
			`[handleStart] cluster=${selectedLabel}, userId=${userId}, billIds count=${clusterData.billIds.length}, existingAnswers count=${existingAnswers.length}, delegatedVotes count=${delegatedVotes.size}, activeDelegations count=${delegatedBillIds.size}`
		);

		// Merge direct + delegated answers
		const allAnswers: { billId: number; score: number; source: 'direct' | 'delegated' }[] =
			existingAnswers
				.filter((a) => a.answer !== 'delegated')
				.map((a) => ({
					billId: a.billId,
					score: answerToScore(a.answer),
					source: 'direct' as const
				}));
		for (const [billId, score] of delegatedVotes) {
			// Only add if not already in direct answers
			if (!allAnswers.some((a) => a.billId === billId)) {
				allAnswers.push({ billId, score, source: 'delegated' });
			}
		}
		// Add pending delegated bills (not yet voted by delegate) — mark as answered
		// so they're skipped in question selection, but don't include in vector estimation
		const pendingDelegatedBillIds = new Set<number>();
		for (const billId of delegatedBillIds) {
			if (!allAnswers.some((a) => a.billId === billId)) {
				allAnswers.push({ billId, score: 0, source: 'delegated' });
				pendingDelegatedBillIds.add(billId);
			}
		}

		// Populate source per bill for frontend
		for (const a of allAnswers) {
			billSourceMap.set(a.billId, a.source);
		}
		// Override: any bill with active delegation is 'delegated' regardless
		for (const billId of delegatedBillIds) {
			billSourceMap.set(billId, 'delegated');
			delegationStatusMap.set(billId, delegatedVotes.has(billId) ? 'voted' : 'pending');
		}

		if (allAnswers.length > 0) {
			// Build bill loadings map for vector updates
			const billLoadingsMap = new Map<number, number[]>();
			for (let i = 0; i < clusterData.billIds.length; i++) {
				billLoadingsMap.set(clusterData.billIds[i], clusterData.billLoadings[i]);
			}

			// Apply each existing answer to update the user vector
			// Skip pending delegations — they have no meaningful score yet
			for (const answer of allAnswers) {
				if (pendingDelegatedBillIds.has(answer.billId)) {
					// Still mark as answered for question skipping
					state.answeredBills.push({ billId: answer.billId, score: 0 });
					state.questionCount++;
					continue;
				}
				const userAnswer: UserAnswer = { billId: answer.billId, score: answer.score };
				const newState = updateMatchingState(state, userAnswer, billLoadingsMap);
				state.userVector = newState.userVector;
				state.answeredBills = newState.answeredBills;
				state.questionCount = newState.questionCount;
				state.uncertainty = newState.uncertainty;
			}

			// Store pending delegation IDs on state for future updateMatchingState calls
			state.pendingDelegationBillIds = pendingDelegatedBillIds;
		}
	}

	// Generate session ID
	const sessionIdValue = crypto.randomUUID();

	// Store session
	sessions.set(sessionIdValue, {
		state,
		clusterData,
		billInfoMap,
		createdAt: new Date()
	});

	// Get first question (will skip already-answered bills)
	const nextQuestion = selectNextQuestion(state, clusterData, billInfoMap);

	// Prepare member vectors for 2D visualization
	// Include member names and group info
	const memberIds = Object.keys(clusterData.memberVectors).map((id) => parseInt(id));
	const groupMap = await loadMemberGroups(memberIds);

	const memberVectorsForViz = Object.entries(clusterData.memberVectors).map(([id, vector]) => ({
		memberId: parseInt(id),
		name: clusterData.memberNames[id] || `Member ${id}`,
		group: groupMap.get(parseInt(id)) || null,
		latentVector: vector
	}));

	// Get current matches if we have pre-existing answers
	const preExistingMatches =
		state.answeredBills.length > 0 ? findMatchingMembers(state.userVector, clusterData, 10) : [];

	// Enrich matches with group info
	if (preExistingMatches.length > 0) {
		const matchMemberIds = preExistingMatches.map((m: MatchResult) => m.member.memberId);
		const matchGroupMap = await loadMemberGroups(matchMemberIds);
		for (const match of preExistingMatches) {
			match.member.group = matchGroupMap.get(match.member.memberId) || null;
		}
	}

	return json({
		success: true,
		sessionId: sessionIdValue,
		clusterId: savedVectorId ? clusterInfo.id : clusterId,
		clusterLabel: selectedLabel,
		clusterName: clusterInfo.name,
		dimensions: clusterData.dimensions,
		totalBills: clusterData.billCount,
		totalMembers: clusterData.memberCount,
		questionCount: state.answeredBills.length,
		nextQuestion: nextQuestion
			? {
					billId: nextQuestion.bill.billId,
					title: nextQuestion.bill.title,
					description: nextQuestion.bill.description,
					passed: nextQuestion.bill.passed,
					result: nextQuestion.bill.result,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget,
					billType: nextQuestion.bill.billType,
					submissionSession: nextQuestion.bill.submissionSession,
					billNumber: nextQuestion.bill.billNumber
				}
			: null,
		uncertainty: state.uncertainty,
		userVector: state.userVector,
		topMatches: preExistingMatches.slice(0, 5).map((m: MatchResult) => ({
			memberId: m.member.memberId,
			name: m.member.name,
			group: m.member.group,
			similarity: m.similarity,
			rank: m.rank,
			latentVector: clusterData.memberVectors[String(m.member.memberId)]
		})),
		preExistingAnswerCount: state.answeredBills.length,
		preExistingAnsweredBills: state.answeredBills.map((ab) => {
			const info = billInfoMap.get(ab.billId);
			const source = billSourceMap.get(ab.billId) || 'direct';
			return {
				billId: ab.billId,
				title: info?.title || `法案 #${ab.billId}`,
				answer: ab.score,
				source,
				billType: info?.billType,
				submissionSession: info?.submissionSession,
				billNumber: info?.billNumber,
				...(source === 'delegated' && {
					delegationStatus: delegationStatusMap.get(ab.billId) || 'pending',
					delegateId: delegateIdMap.get(ab.billId)
				})
			};
		}),
		memberVectors: memberVectorsForViz,
		explainedVariance: clusterData.explainedVariance
	});
}

/**
 * Resume a matching session with existing user vector and answered bills excluded
 */
async function handleResume(
	savedVectorId: number | null,
	existingUserVector: number[] | null,
	answeredBillIds: number[] = [],
	userId: string | null = null,
	answeredBillsWithScores?: { billId: number; score: number }[]
) {
	if (!savedVectorId) {
		return json({ error: 'savedVectorId is required for resume' }, { status: 400 });
	}

	// Load saved vector data from database
	const [savedResult] = await db
		.select()
		.from(clusterVectorResults)
		.where(eq(clusterVectorResults.id, savedVectorId));

	if (!savedResult) {
		return json({ error: 'Saved vector result not found' }, { status: 404 });
	}

	// Get cluster info
	const [cluster] = await db
		.select()
		.from(billClusters)
		.where(eq(billClusters.id, savedResult.clusterId));

	if (!cluster) {
		return json({ error: 'Cluster not found' }, { status: 404 });
	}

	// Parse the saved data
	const clusterData: ClusterVectorData = {
		memberVectors: JSON.parse(savedResult.memberVectors),
		memberNames: JSON.parse(savedResult.memberNames),
		billLoadings: JSON.parse(savedResult.billLoadings),
		billIds: JSON.parse(savedResult.billIds),
		explainedVariance: JSON.parse(savedResult.explainedVariance),
		dimensions: savedResult.dimensions,
		memberCount: savedResult.memberCount,
		billCount: savedResult.billCount
	};

	// Load bill information from database
	const dbBillInfo = await loadBillInfo(clusterData.billIds);
	const billInfoMap = buildBillInfoMap(clusterData, dbBillInfo);

	// Initialize matching state
	const state = initializeMatchingState(
		savedResult.clusterId,
		savedResult.clusterLabel,
		clusterData.dimensions
	);

	// Track source per bill for frontend response
	const resumeBillSourceMap = new Map<number, 'direct' | 'delegated'>();
	const resumeDelegationStatusMap = new Map<number, 'pending' | 'voted'>();
	const resumeDelegateIdMap = new Map<number, string>();

	// If user is logged in, load all answers from user_bill_answer for bills in this cluster
	if (userId) {
		const existingAnswers = await db
			.select()
			.from(userBillAnswer)
			.where(
				and(eq(userBillAnswer.userId, userId), inArray(userBillAnswer.billId, clusterData.billIds))
			);

		// Also resolve delegated votes for bills in this cluster
		const delegatedVotes = await resolveDelegatedVotes(userId, clusterData.billIds);

		// Find bills with active (non-rejected) outgoing delegations
		const activeDelegations = await db
			.select({ billId: voteDelegation.billId, delegateId: voteDelegation.delegateId })
			.from(voteDelegation)
			.where(
				and(
					eq(voteDelegation.delegatorId, userId),
					inArray(voteDelegation.billId, clusterData.billIds),
					sql`${voteDelegation.status} != 'rejected'`
				)
			);
		const delegatedBillIds = new Set(activeDelegations.map((d) => d.billId));
		for (const d of activeDelegations) {
			resumeDelegateIdMap.set(d.billId, d.delegateId);
		}

		// Merge direct + delegated answers
		const allAnswers: { billId: number; score: number; source: 'direct' | 'delegated' }[] =
			existingAnswers
				.filter((a) => a.answer !== 'delegated')
				.map((a) => ({
					billId: a.billId,
					score: answerToScore(a.answer),
					source: 'direct' as const
				}));
		for (const [billId, score] of delegatedVotes) {
			if (!allAnswers.some((a) => a.billId === billId)) {
				allAnswers.push({ billId, score, source: 'delegated' });
			}
		}
		// Add pending delegated bills — mark as answered but don't include in vector estimation
		const resumePendingDelegatedBillIds = new Set<number>();
		for (const billId of delegatedBillIds) {
			if (!allAnswers.some((a) => a.billId === billId)) {
				allAnswers.push({ billId, score: 0, source: 'delegated' });
				resumePendingDelegatedBillIds.add(billId);
			}
		}

		// Populate source & delegation status maps
		for (const a of allAnswers) {
			resumeBillSourceMap.set(a.billId, a.source);
		}
		for (const billId of delegatedBillIds) {
			resumeBillSourceMap.set(billId, 'delegated');
			resumeDelegationStatusMap.set(billId, delegatedVotes.has(billId) ? 'voted' : 'pending');
		}

		if (allAnswers.length > 0) {
			// Build bill loadings map for vector updates
			const billLoadingsMap = new Map<number, number[]>();
			for (let i = 0; i < clusterData.billIds.length; i++) {
				billLoadingsMap.set(clusterData.billIds[i], clusterData.billLoadings[i]);
			}

			// Apply each existing answer to update the user vector
			// Skip pending delegations — they have no meaningful score yet
			for (const answer of allAnswers) {
				if (resumePendingDelegatedBillIds.has(answer.billId)) {
					// Still mark as answered for question skipping
					state.answeredBills.push({ billId: answer.billId, score: 0 });
					state.questionCount++;
					continue;
				}
				const userAnswer: UserAnswer = { billId: answer.billId, score: answer.score };
				const newState = updateMatchingState(state, userAnswer, billLoadingsMap);
				state.userVector = newState.userVector;
				state.answeredBills = newState.answeredBills;
				state.questionCount = newState.questionCount;
				state.uncertainty = newState.uncertainty;
			}

			// Store pending delegation IDs on state for future updateMatchingState calls
			state.pendingDelegationBillIds = resumePendingDelegatedBillIds;
		}
	} else {
		// Not logged in — use the provided answeredBills (with scores) or answeredBillIds
		if (answeredBillsWithScores && answeredBillsWithScores.length > 0) {
			// Use full answered bills with scores for proper vector estimation
			const billLoadingsMap = new Map<number, number[]>();
			for (let i = 0; i < clusterData.billIds.length; i++) {
				billLoadingsMap.set(clusterData.billIds[i], clusterData.billLoadings[i]);
			}

			for (const ab of answeredBillsWithScores) {
				const userAnswer: UserAnswer = { billId: ab.billId, score: ab.score };
				const newState = updateMatchingState(state, userAnswer, billLoadingsMap);
				state.userVector = newState.userVector;
				state.answeredBills = newState.answeredBills;
				state.questionCount = newState.questionCount;
				state.uncertainty = newState.uncertainty;
			}
		} else {
			// Fallback: use IDs only (score 0) and provided user vector
			if (existingUserVector && existingUserVector.length === clusterData.dimensions) {
				state.userVector = [...existingUserVector];
			}

			for (const billId of answeredBillIds) {
				state.answeredBills.push({ billId, score: 0 }); // Score doesn't matter for exclusion
			}
		}
	}

	// Generate session ID
	const sessionIdValue = crypto.randomUUID();

	// Store session
	sessions.set(sessionIdValue, {
		state,
		clusterData,
		billInfoMap,
		createdAt: new Date()
	});

	// Get next unanswered question
	const nextQuestion = selectNextQuestion(state, clusterData, billInfoMap);

	// Prepare member vectors for 2D visualization
	const memberIds = Object.keys(clusterData.memberVectors).map((id) => parseInt(id));
	const groupMap = await loadMemberGroups(memberIds);

	const memberVectorsForViz = Object.entries(clusterData.memberVectors).map(([id, vector]) => ({
		memberId: parseInt(id),
		name: clusterData.memberNames[id] || `Member ${id}`,
		group: groupMap.get(parseInt(id)) || null,
		latentVector: vector
	}));

	// Get current matches with the existing user vector
	const matches = findMatchingMembers(state.userVector, clusterData);
	const matchResults = matches.slice(0, 5).map((m) => ({
		memberId: m.member.memberId,
		name: m.member.name,
		group: groupMap.get(m.member.memberId) || null,
		similarity: m.similarity,
		rank: m.rank,
		latentVector: clusterData.memberVectors[String(m.member.memberId)]
	}));

	return json({
		success: true,
		sessionId: sessionIdValue,
		clusterId: savedResult.clusterId,
		clusterLabel: savedResult.clusterLabel,
		clusterName: cluster.name,
		dimensions: clusterData.dimensions,
		totalBills: clusterData.billCount,
		totalMembers: clusterData.memberCount,
		questionCount: state.answeredBills.length,
		nextQuestion: nextQuestion
			? {
					billId: nextQuestion.bill.billId,
					title: nextQuestion.bill.title,
					description: nextQuestion.bill.description,
					passed: nextQuestion.bill.passed,
					result: nextQuestion.bill.result,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget,
					billType: nextQuestion.bill.billType,
					submissionSession: nextQuestion.bill.submissionSession,
					billNumber: nextQuestion.bill.billNumber
				}
			: null,
		uncertainty: state.uncertainty,
		userVector: state.userVector,
		topMatches: matchResults,
		preExistingAnswerCount: state.answeredBills.length,
		preExistingAnsweredBills: state.answeredBills.map((ab) => {
			const info = billInfoMap.get(ab.billId);
			const source = resumeBillSourceMap.get(ab.billId) || 'direct';
			return {
				billId: ab.billId,
				title: info?.title || `法案 #${ab.billId}`,
				answer: ab.score,
				source,
				billType: info?.billType,
				submissionSession: info?.submissionSession,
				billNumber: info?.billNumber,
				...(source === 'delegated' && {
					delegationStatus: resumeDelegationStatusMap.get(ab.billId) || 'pending',
					delegateId: resumeDelegateIdMap.get(ab.billId)
				})
			};
		}),
		memberVectors: memberVectorsForViz,
		explainedVariance: clusterData.explainedVariance
	});
}

/**
 * Handle user answer and return next question
 */
async function handleAnswer(
	sessionId: string,
	billId: number,
	score: number,
	userId: string | null = null,
	savedVectorId?: number,
	clientUserVector?: number[],
	clientAnsweredBills?: { billId: number; score: number }[]
) {
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = await getOrReconstructSession(
		sessionId,
		savedVectorId,
		clientUserVector,
		clientAnsweredBills
	);
	if (!session) {
		return json({ error: 'Session not found or expired' }, { status: 404 });
	}

	if (billId === undefined || score === undefined) {
		return json({ error: 'billId and score are required' }, { status: 400 });
	}

	// Validate score is in range [-1, 1]
	const normalizedScore = Math.max(-1, Math.min(1, score));

	// Persist answer to user_bill_answer if user is logged in
	// But skip if user has an active outgoing delegation for this bill (delegate decides)
	if (userId) {
		const [activeDelegation] = await db
			.select({ id: voteDelegation.id, delegateId: voteDelegation.delegateId })
			.from(voteDelegation)
			.where(
				and(
					eq(voteDelegation.delegatorId, userId),
					eq(voteDelegation.billId, billId),
					sql`${voteDelegation.status} != 'rejected'`
				)
			)
			.limit(1);

		if (!activeDelegation) {
			// Check if user's vote changed and they are a delegate with voted incoming delegations
			const [existingAnswer] = await db
				.select({ answer: userBillAnswer.answer })
				.from(userBillAnswer)
				.where(and(eq(userBillAnswer.userId, userId), eq(userBillAnswer.billId, billId)));

			const oldAnswer = existingAnswer?.answer;
			const newAnswer = scoreToAnswer(normalizedScore);
			const voteChanged = oldAnswer && oldAnswer !== 'delegated' && oldAnswer !== newAnswer;

			await db
				.insert(userBillAnswer)
				.values({
					userId,
					billId,
					answer: newAnswer
				})
				.onConflictDoUpdate({
					target: [userBillAnswer.userId, userBillAnswer.billId],
					set: {
						answer: newAnswer,
						updatedAt: sql`now()`
					}
				});

			// If vote changed and user has accepted (voted) incoming delegations, notify delegators
			if (voteChanged) {
				const votedIncoming = await db
					.select({
						id: voteDelegation.id,
						delegatorId: voteDelegation.delegatorId
					})
					.from(voteDelegation)
					.where(
						and(
							eq(voteDelegation.delegateId, userId),
							eq(voteDelegation.billId, billId),
							eq(voteDelegation.status, 'voted')
						)
					);

				if (votedIncoming.length > 0) {
					const [billInfo] = await db
						.select({ title: billTable.title })
						.from(billTable)
						.where(eq(billTable.id, billId));
					const [userInfo] = await db
						.select({ username: userTable.username })
						.from(userTable)
						.where(eq(userTable.id, userId));
					const billTitle = billInfo?.title ?? null;
					const username = userInfo?.username ?? 'ユーザー';

					for (const d of votedIncoming) {
						await notifyDelegationVoteChanged(
							d.delegatorId,
							userId,
							username,
							d.id,
							billId,
							billTitle,
							normalizedScore
						);
					}
					// Notify upstream delegators through redelegation chains
					await notifyUpstreamDelegatorsVoteChanged(
						userId,
						userId,
						username,
						billId,
						billTitle,
						normalizedScore
					);
				}
			}
		} else {
			// User is overriding a delegation with a direct vote — retract the delegation
			await db
				.update(voteDelegation)
				.set({ status: 'rejected' })
				.where(
					and(
						eq(voteDelegation.delegatorId, userId),
						eq(voteDelegation.billId, billId),
						sql`${voteDelegation.status} != 'rejected'`
					)
				);
			await db
				.insert(userBillAnswer)
				.values({
					userId,
					billId,
					answer: scoreToAnswer(normalizedScore)
				})
				.onConflictDoUpdate({
					target: [userBillAnswer.userId, userBillAnswer.billId],
					set: {
						answer: scoreToAnswer(normalizedScore),
						updatedAt: sql`now()`
					}
				});

			// Notify the delegate that the delegator overrode the delegation
			const [billInfo] = await db
				.select({ title: billTable.title })
				.from(billTable)
				.where(eq(billTable.id, billId));
			const [userInfo] = await db
				.select({ username: userTable.username })
				.from(userTable)
				.where(eq(userTable.id, userId));
			await notifyDelegationOverridden(
				activeDelegation.delegateId,
				userId,
				userInfo?.username ?? 'ユーザー',
				activeDelegation.id,
				billId,
				billInfo?.title ?? null
			);
		}
	}

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
	let nextQuestion = selectNextQuestion(newState, session.clusterData, session.billInfoMap);

	// Server-side safety check: ensure nextQuestion is not already in answeredBills
	// This guards against any edge case where reconstruction + selectNextQuestion desyncs
	const answeredBillIdSet = new Set(newState.answeredBills.map((a) => a.billId));
	if (nextQuestion && answeredBillIdSet.has(nextQuestion.bill.billId)) {
		console.warn(
			`[handleAnswer] selectNextQuestion returned already-answered bill ${nextQuestion.bill.billId}, skipping`
		);
		// Force-skip by adding it as answered and re-selecting
		const skipAnswer: UserAnswer = {
			billId: nextQuestion.bill.billId,
			score: newState.answeredBills.find((a) => a.billId === nextQuestion!.bill.billId)?.score ?? 0
		};
		const fixedState = updateMatchingState(newState, skipAnswer, billLoadingsMap);
		session.state = fixedState;
		nextQuestion = selectNextQuestion(fixedState, session.clusterData, session.billInfoMap);
	}

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
					result: nextQuestion.bill.result,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget,
					billType: nextQuestion.bill.billType,
					submissionSession: nextQuestion.bill.submissionSession,
					billNumber: nextQuestion.bill.billNumber
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
async function handleSkip(
	sessionId: string,
	billId: number,
	userId: string | null = null,
	savedVectorId?: number,
	clientUserVector?: number[],
	clientAnsweredBills?: { billId: number; score: number }[]
) {
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = await getOrReconstructSession(
		sessionId,
		savedVectorId,
		clientUserVector,
		clientAnsweredBills
	);
	if (!session) {
		return json({ error: 'Session not found or expired' }, { status: 404 });
	}

	// Persist skip to user_bill_answer if user is logged in
	// But skip if user has an active outgoing delegation for this bill
	if (userId) {
		const [activeDelegation] = await db
			.select({ id: voteDelegation.id })
			.from(voteDelegation)
			.where(
				and(
					eq(voteDelegation.delegatorId, userId),
					eq(voteDelegation.billId, billId),
					sql`${voteDelegation.status} != 'rejected'`
				)
			)
			.limit(1);

		if (!activeDelegation) {
			await db
				.insert(userBillAnswer)
				.values({
					userId,
					billId,
					answer: 'skip'
				})
				.onConflictDoUpdate({
					target: [userBillAnswer.userId, userBillAnswer.billId],
					set: {
						answer: 'skip',
						updatedAt: sql`now()`
					}
				});
		}
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
	let nextQuestion = selectNextQuestion(newState, session.clusterData, session.billInfoMap);

	// Server-side safety check: ensure nextQuestion is not already answered
	const skipAnsweredBillIdSet = new Set(newState.answeredBills.map((a) => a.billId));
	if (nextQuestion && skipAnsweredBillIdSet.has(nextQuestion.bill.billId)) {
		console.warn(
			`[handleSkip] selectNextQuestion returned already-answered bill ${nextQuestion.bill.billId}, skipping`
		);
		const skipAnswer2: UserAnswer = {
			billId: nextQuestion.bill.billId,
			score: newState.answeredBills.find((a) => a.billId === nextQuestion!.bill.billId)?.score ?? 0
		};
		const fixedState = updateMatchingState(newState, skipAnswer2, billLoadingsMap);
		session.state = fixedState;
		nextQuestion = selectNextQuestion(fixedState, session.clusterData, session.billInfoMap);
	}

	return json({
		success: true,
		questionCount: newState.questionCount,
		nextQuestion: nextQuestion
			? {
					billId: nextQuestion.bill.billId,
					title: nextQuestion.bill.title,
					description: nextQuestion.bill.description,
					passed: nextQuestion.bill.passed,
					result: nextQuestion.bill.result,
					reason: nextQuestion.reason,
					dimensionTarget: nextQuestion.dimensionTarget,
					billType: nextQuestion.bill.billType,
					submissionSession: nextQuestion.bill.submissionSession,
					billNumber: nextQuestion.bill.billNumber
				}
			: null,
		uncertainty: newState.uncertainty,
		userVector: newState.userVector,
		isComplete: nextQuestion === null
	});
}

/**
 * Retract a user's own answer on a bill
 */
async function handleRetractAnswer(billId: number, userId: string | null) {
	if (!userId) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	if (!billId) {
		return json({ error: '法案IDが必要です' }, { status: 400 });
	}

	// Check if there's an active incoming delegation where this user voted on someone else's behalf
	const [incomingVoted] = await db
		.select()
		.from(voteDelegation)
		.where(
			and(
				eq(voteDelegation.delegateId, userId),
				eq(voteDelegation.billId, billId),
				eq(voteDelegation.status, 'voted')
			)
		);

	if (incomingVoted) {
		return json(
			{ error: 'この法案は代理投票済みのため、先に委任タブから対応してください' },
			{ status: 400 }
		);
	}

	// Delete the user's answer (but not if it's a 'delegated' placeholder)
	const result = await db
		.delete(userBillAnswer)
		.where(
			and(
				eq(userBillAnswer.userId, userId),
				eq(userBillAnswer.billId, billId),
				sql`${userBillAnswer.answer} != 'delegated'`
			)
		)
		.returning();

	if (result.length === 0) {
		return json({ error: 'この法案への回答が見つかりません' }, { status: 404 });
	}

	return json({ success: true, message: '回答を取り消しました' });
}

/**
 * Directly vote on a bill from outside a matching session (e.g. from answer history).
 * Persists to user_bill_answer. Respects active delegations.
 */
async function handleDirectVote(billId: number, score: number, userId: string | null) {
	if (!userId) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	if (!billId || score === undefined || score === null) {
		return json({ error: '法案IDとスコアが必要です' }, { status: 400 });
	}

	const normalizedScore = Math.max(-1, Math.min(1, score));

	// Check for active outgoing delegation — delegate decides, not the user
	const [activeDelegation] = await db
		.select({ id: voteDelegation.id })
		.from(voteDelegation)
		.where(
			and(
				eq(voteDelegation.delegatorId, userId),
				eq(voteDelegation.billId, billId),
				sql`${voteDelegation.status} != 'rejected'`
			)
		)
		.limit(1);

	if (activeDelegation) {
		return json(
			{ error: 'この法案は委任中のため、直接投票できません。先に委任を取り消してください。' },
			{ status: 400 }
		);
	}

	await db
		.insert(userBillAnswer)
		.values({
			userId,
			billId,
			answer: scoreToAnswer(normalizedScore)
		})
		.onConflictDoUpdate({
			target: [userBillAnswer.userId, userBillAnswer.billId],
			set: {
				answer: scoreToAnswer(normalizedScore),
				updatedAt: sql`now()`
			}
		});

	return json({ success: true, score: normalizedScore });
}

/**
 * Get full matching results
 */
async function handleResults(
	sessionId: string,
	savedVectorId?: number,
	clientUserVector?: number[],
	clientAnsweredBills?: { billId: number; score: number }[]
) {
	if (!sessionId) {
		return json({ error: 'sessionId is required' }, { status: 400 });
	}

	const session = await getOrReconstructSession(
		sessionId,
		savedVectorId,
		clientUserVector,
		clientAnsweredBills
	);
	if (!session) {
		return json({ error: 'Session not found or expired' }, { status: 404 });
	}

	const { state, clusterData } = session;

	// Get all matches (no limit - include negative similarities too)
	const matches = findMatchingMembers(state.userVector, clusterData, Infinity);

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
 * Get available clusters and saved vector results for matching
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
			clusters.map(async (cluster) => {
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
			})
		);

		// Get saved vector results with cluster label names
		const savedVectors = await db
			.select({
				id: clusterVectorResults.id,
				clusterId: clusterVectorResults.clusterId,
				clusterLabel: clusterVectorResults.clusterLabel,
				nComponents: clusterVectorResults.nComponents,
				name: clusterVectorResults.name,
				dimensions: clusterVectorResults.dimensions,
				memberCount: clusterVectorResults.memberCount,
				billCount: clusterVectorResults.billCount,
				createdAt: clusterVectorResults.createdAt,
				clusterLabelName: billClusterLabelNames.name,
				isDefault: clusterVectorResults.isDefault
			})
			.from(clusterVectorResults)
			.leftJoin(
				billClusterLabelNames,
				and(
					eq(clusterVectorResults.clusterId, billClusterLabelNames.clusterId),
					eq(clusterVectorResults.clusterLabel, billClusterLabelNames.clusterLabel)
				)
			)
			.orderBy(desc(clusterVectorResults.createdAt));

		return json({
			success: true,
			clusters: clustersWithLabels,
			savedVectors
		});
	} catch (error) {
		console.error('Error fetching clusters:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
