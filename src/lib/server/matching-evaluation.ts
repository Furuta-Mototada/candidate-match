/**
 * Adaptive Question Selection Evaluation
 *
 * Simulates different question selection strategies using real member data
 * as ground truth, measuring convergence speed and accuracy.
 *
 * Strategies compared:
 * 1. CAT (current) — uncertainty × controversy scoring
 * 2. Random — uniformly random unanswered bill
 * 3. Most-controversial — highest member vote variance
 * 4. Round-robin — cycle through dimensions, pick strongest loading
 */

import {
	initializeMatchingState,
	estimateUserVector,
	selectNextQuestion,
	cosineSimilarity,
	findMatchingMembers,
	buildBillInfoMap,
	loadBillInfo,
	type ClusterVectorData,
	type MatchingState,
	type UserAnswer,
	type BillInfo
} from './matching.js';

// ============================================================================
// Types
// ============================================================================

export type StrategyName = 'cat' | 'random' | 'controversial' | 'round-robin';

export interface EvaluationStep {
	questionNumber: number;
	billId: number;
	cosineError: number; // 1 - cos(estimated, true)
	vectorMSE: number; // mean squared error of vector
	uncertaintySum: number; // sum of uncertainty across dimensions
	top1Correct: boolean; // is rank-1 the simulated member?
	top5Correct: boolean; // is simulated member in top-5?
	trueRank: number; // rank of the simulated member
}

export interface StrategyResult {
	strategy: StrategyName;
	memberId: number;
	memberName: string;
	steps: EvaluationStep[];
}

export interface EvaluationResult {
	strategies: StrategyResult[];
	aggregated: AggregatedMetrics[];
	memberCount: number;
	billCount: number;
	dimensions: number;
	clusterLabel: number;
	sampleMemberIds: number[];
}

export interface AggregatedMetrics {
	strategy: StrategyName;
	/** Average cosine error at each question number (index = questionNumber - 1) */
	avgCosineError: number[];
	/** Average vector MSE at each question number */
	avgVectorMSE: number[];
	/** Average uncertainty sum at each question number */
	avgUncertaintySum: number[];
	/** Average true rank of simulated member at each question */
	avgTrueRank: number[];
	/** Fraction of simulations where member is in top-5 at each question */
	top5Rate: number[];
	/** Average questions until cosine error < threshold */
	avgQuestionsToConverge: number | null;
}

// ============================================================================
// Question Selection Strategies
// ============================================================================

/**
 * Strategy: Random selection — pick a uniformly random unanswered bill
 */
function selectRandomQuestion(
	state: MatchingState,
	clusterData: ClusterVectorData
): { billId: number; billIndex: number } | null {
	const answeredBillIds = new Set(state.answeredBills.map((a) => a.billId));
	const candidates: { billId: number; billIndex: number }[] = [];

	for (let idx = 0; idx < clusterData.billIds.length; idx++) {
		const billId = clusterData.billIds[idx];
		if (!answeredBillIds.has(billId) && clusterData.billLoadings[idx]) {
			candidates.push({ billId, billIndex: idx });
		}
	}

	if (candidates.length === 0) return null;
	return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Strategy: Most-controversial — pick bill with highest member vote variance
 */
function selectControversialQuestion(
	state: MatchingState,
	clusterData: ClusterVectorData
): { billId: number; billIndex: number } | null {
	const answeredBillIds = new Set(state.answeredBills.map((a) => a.billId));
	const memberVectors = Object.values(clusterData.memberVectors);

	let best: { billId: number; billIndex: number; variance: number } | null = null;

	for (let idx = 0; idx < clusterData.billIds.length; idx++) {
		const billId = clusterData.billIds[idx];
		if (answeredBillIds.has(billId)) continue;

		const loading = clusterData.billLoadings[idx];
		if (!loading) continue;

		// Project members onto this bill's direction
		const projectedScores = memberVectors.map((mv) => {
			let proj = 0;
			for (let d = 0; d < state.dimensions; d++) {
				proj += mv[d] * loading[d];
			}
			return proj;
		});

		const mean = projectedScores.reduce((a, b) => a + b, 0) / projectedScores.length;
		const variance =
			projectedScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / projectedScores.length;

		if (!best || variance > best.variance) {
			best = { billId, billIndex: idx, variance };
		}
	}

	return best ? { billId: best.billId, billIndex: best.billIndex } : null;
}

/**
 * Strategy: Round-robin — cycle through dimensions, pick bill with highest loading on target dim
 */
function selectRoundRobinQuestion(
	state: MatchingState,
	clusterData: ClusterVectorData
): { billId: number; billIndex: number } | null {
	const answeredBillIds = new Set(state.answeredBills.map((a) => a.billId));
	const targetDim = state.questionCount % state.dimensions;

	let best: { billId: number; billIndex: number; loading: number } | null = null;

	for (let idx = 0; idx < clusterData.billIds.length; idx++) {
		const billId = clusterData.billIds[idx];
		if (answeredBillIds.has(billId)) continue;

		const loading = clusterData.billLoadings[idx];
		if (!loading) continue;

		const absLoading = Math.abs(loading[targetDim]);
		if (!best || absLoading > best.loading) {
			best = { billId, billIndex: idx, loading: absLoading };
		}
	}

	return best ? { billId: best.billId, billIndex: best.billIndex } : null;
}

/**
 * Select next bill for a given strategy
 */
function selectNextBillForStrategy(
	strategy: StrategyName,
	state: MatchingState,
	clusterData: ClusterVectorData,
	billInfoMap: Map<number, BillInfo>
): number | null {
	switch (strategy) {
		case 'cat': {
			const q = selectNextQuestion(state, clusterData, billInfoMap);
			return q ? q.bill.billId : null;
		}
		case 'random': {
			const q = selectRandomQuestion(state, clusterData);
			return q ? q.billId : null;
		}
		case 'controversial': {
			const q = selectControversialQuestion(state, clusterData);
			return q ? q.billId : null;
		}
		case 'round-robin': {
			const q = selectRoundRobinQuestion(state, clusterData);
			return q ? q.billId : null;
		}
	}
}

// ============================================================================
// Simulation
// ============================================================================

/**
 * Simulate a user answering questions as a specific member.
 *
 * The "true answer" for each bill is derived from the member's projected score
 * on that bill, quantized to -1/0/+1.
 */
function simulateMemberAnswers(
	memberId: number,
	clusterData: ClusterVectorData
): Map<number, number> {
	const memberVector = clusterData.memberVectors[String(memberId)];
	if (!memberVector) return new Map();

	const answers = new Map<number, number>();
	for (let idx = 0; idx < clusterData.billIds.length; idx++) {
		const billId = clusterData.billIds[idx];
		const loading = clusterData.billLoadings[idx];
		if (!loading) continue;

		// Project member vector onto bill loading direction
		let projected = 0;
		for (let d = 0; d < memberVector.length; d++) {
			projected += memberVector[d] * loading[d];
		}

		// Quantize to -1/0/+1 with thresholds
		let answer: number;
		if (projected > 0.3) answer = 1;
		else if (projected < -0.3) answer = -1;
		else answer = 0;

		answers.set(billId, answer);
	}

	return answers;
}

/**
 * Run one simulation: given a strategy and a "ground truth" member,
 * simulate answering bills one at a time and track metrics at each step.
 */
function runSingleSimulation(
	strategy: StrategyName,
	memberId: number,
	memberName: string,
	clusterData: ClusterVectorData,
	billInfoMap: Map<number, BillInfo>,
	maxQuestions: number,
	seed: number
): StrategyResult {
	const trueVector = clusterData.memberVectors[String(memberId)];
	const dimensions = trueVector.length;

	// Pre-compute the member's answers to all bills
	const memberAnswers = simulateMemberAnswers(memberId, clusterData);

	// Initialize matching state
	const state = initializeMatchingState(0, 0, dimensions);

	// Build bill loadings map for vector updates
	const billLoadingsMap = new Map<number, number[]>();
	for (let i = 0; i < clusterData.billIds.length; i++) {
		billLoadingsMap.set(clusterData.billIds[i], clusterData.billLoadings[i]);
	}

	// Seed a simple PRNG for random strategy reproducibility
	let rngState = seed;
	const originalRandom = Math.random;
	if (strategy === 'random') {
		Math.random = () => {
			rngState = (rngState * 1664525 + 1013904223) & 0x7fffffff;
			return rngState / 0x7fffffff;
		};
	}

	const steps: EvaluationStep[] = [];

	for (let q = 0; q < maxQuestions; q++) {
		// Select next bill based on strategy
		const billId = selectNextBillForStrategy(strategy, state, clusterData, billInfoMap);
		if (billId === null) break;

		// "Answer" the bill as if we are this member
		const score = memberAnswers.get(billId) ?? 0;
		const answer: UserAnswer = { billId, score };

		state.answeredBills.push(answer);
		state.questionCount++;

		// Re-estimate user vector from all answers so far
		const { vector, uncertainty } = estimateUserVector(
			state.answeredBills,
			billLoadingsMap,
			dimensions
		);
		state.userVector = vector;
		state.uncertainty = uncertainty;

		// Compute metrics
		const cosError = 1 - cosineSimilarity(vector, trueVector);

		let mse = 0;
		for (let d = 0; d < dimensions; d++) {
			mse += (vector[d] - trueVector[d]) ** 2;
		}
		mse /= dimensions;

		const uncertaintySum = uncertainty.reduce((a, b) => a + b, 0);

		// Find rank of this member
		const matches = findMatchingMembers(
			vector,
			clusterData,
			Object.keys(clusterData.memberVectors).length
		);
		const memberMatch = matches.find((m) => m.member.memberId === memberId);
		const trueRank = memberMatch ? memberMatch.rank : matches.length + 1;

		steps.push({
			questionNumber: q + 1,
			billId,
			cosineError: cosError,
			vectorMSE: mse,
			uncertaintySum,
			top1Correct: trueRank === 1,
			top5Correct: trueRank <= 5,
			trueRank
		});
	}

	// Restore random
	if (strategy === 'random') {
		Math.random = originalRandom;
	}

	return { strategy, memberId, memberName, steps };
}

/**
 * Aggregate results across multiple member simulations for one strategy
 */
function aggregateResults(
	results: StrategyResult[],
	convergeThreshold: number = 0.2
): AggregatedMetrics {
	if (results.length === 0) {
		return {
			strategy: 'cat',
			avgCosineError: [],
			avgVectorMSE: [],
			avgUncertaintySum: [],
			avgTrueRank: [],
			top5Rate: [],
			avgQuestionsToConverge: null
		};
	}

	const strategy = results[0].strategy;
	const maxSteps = Math.max(...results.map((r) => r.steps.length));

	const avgCosineError: number[] = [];
	const avgVectorMSE: number[] = [];
	const avgUncertaintySum: number[] = [];
	const avgTrueRank: number[] = [];
	const top5Rate: number[] = [];

	for (let q = 0; q < maxSteps; q++) {
		let cosSum = 0,
			mseSum = 0,
			uncSum = 0,
			rankSum = 0,
			top5Count = 0,
			count = 0;

		for (const r of results) {
			if (q < r.steps.length) {
				cosSum += r.steps[q].cosineError;
				mseSum += r.steps[q].vectorMSE;
				uncSum += r.steps[q].uncertaintySum;
				rankSum += r.steps[q].trueRank;
				if (r.steps[q].top5Correct) top5Count++;
				count++;
			}
		}

		if (count > 0) {
			avgCosineError.push(cosSum / count);
			avgVectorMSE.push(mseSum / count);
			avgUncertaintySum.push(uncSum / count);
			avgTrueRank.push(rankSum / count);
			top5Rate.push(top5Count / count);
		}
	}

	// Average questions to converge
	const convergences: number[] = [];
	for (const r of results) {
		const step = r.steps.find((s) => s.cosineError < convergeThreshold);
		if (step) convergences.push(step.questionNumber);
	}
	const avgQuestionsToConverge =
		convergences.length > 0 ? convergences.reduce((a, b) => a + b, 0) / convergences.length : null;

	return {
		strategy,
		avgCosineError,
		avgVectorMSE,
		avgUncertaintySum,
		avgTrueRank,
		top5Rate,
		avgQuestionsToConverge
	};
}

// ============================================================================
// Main Evaluation Entry Point
// ============================================================================

/**
 * Run the full evaluation: for a set of sample members, simulate all 4 strategies
 * and return aggregated + per-member results.
 */
export async function runEvaluation(
	clusterData: ClusterVectorData,
	clusterLabel: number,
	options: {
		maxQuestions?: number;
		sampleSize?: number;
		convergeThreshold?: number;
		strategies?: StrategyName[];
	} = {}
): Promise<EvaluationResult> {
	const maxQuestions = Math.min(options.maxQuestions ?? 20, clusterData.billCount);
	const sampleSize = options.sampleSize ?? 10;
	const convergeThreshold = options.convergeThreshold ?? 0.2;
	const strategies: StrategyName[] = options.strategies ?? [
		'cat',
		'random',
		'controversial',
		'round-robin'
	];

	// Load bill info for CAT strategy (needs BillInfo objects)
	const dbBillInfo = await loadBillInfo(clusterData.billIds);
	const billInfoMap = buildBillInfoMap(clusterData, dbBillInfo);

	// Sample members — pick diverse set using stratified approach
	const allMemberIds = Object.keys(clusterData.memberVectors).map((id) => parseInt(id));
	const sampleMemberIds = sampleMembers(allMemberIds, sampleSize, clusterData);

	// Run simulations
	const allResults: StrategyResult[] = [];

	for (const strategy of strategies) {
		for (let i = 0; i < sampleMemberIds.length; i++) {
			const memberId = sampleMemberIds[i];
			const memberName = clusterData.memberNames[String(memberId)] || `Member ${memberId}`;
			const seed = memberId * 31 + strategies.indexOf(strategy) * 7919; // reproducible seed
			const result = runSingleSimulation(
				strategy,
				memberId,
				memberName,
				clusterData,
				billInfoMap,
				maxQuestions,
				seed
			);
			allResults.push(result);
		}
	}

	// Aggregate per strategy
	const aggregated: AggregatedMetrics[] = strategies.map((strategy) => {
		const strategyResults = allResults.filter((r) => r.strategy === strategy);
		return aggregateResults(strategyResults, convergeThreshold);
	});

	return {
		strategies: allResults,
		aggregated,
		memberCount: allMemberIds.length,
		billCount: clusterData.billCount,
		dimensions: clusterData.dimensions,
		clusterLabel,
		sampleMemberIds
	};
}

/**
 * Sample diverse members for evaluation.
 * Selects members spread across the latent space to avoid biased evaluation.
 */
function sampleMembers(
	memberIds: number[],
	sampleSize: number,
	clusterData: ClusterVectorData
): number[] {
	if (memberIds.length <= sampleSize) return memberIds;

	// Simple approach: sort by first-dimension value, then evenly sample
	const withVectors = memberIds.map((id) => ({
		id,
		vec: clusterData.memberVectors[String(id)]
	}));

	// Sort by the norm of their vector to get a spread of extreme to moderate
	withVectors.sort((a, b) => {
		const normA = Math.sqrt(a.vec.reduce((s, v) => s + v * v, 0));
		const normB = Math.sqrt(b.vec.reduce((s, v) => s + v * v, 0));
		return normA - normB;
	});

	// Evenly sample
	const step = withVectors.length / sampleSize;
	const sampled: number[] = [];
	for (let i = 0; i < sampleSize; i++) {
		const idx = Math.min(Math.floor(i * step), withVectors.length - 1);
		sampled.push(withVectors[idx].id);
	}

	return sampled;
}
