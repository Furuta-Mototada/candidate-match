/**
 * Adaptive Matching Algorithm
 *
 * This module implements a Computerized Adaptive Testing (CAT) style
 * approach for matching users to parliamentary members based on
 * their votes on legislation.
 *
 * Key concepts:
 * - Member latent vectors (z_i): Position of each member in latent space
 * - Bill loadings (v_b): How each bill affects the latent dimensions
 * - User vector (z_user): Estimated position of the user
 * - Uncertainty: Which dimensions are still uncertain for the user
 */

import { db } from './db/index.js';
import { bill, billDetail, group, memberGroup } from './db/schema.js';
import { eq, inArray } from 'drizzle-orm';

// ============================================================================
// Types
// ============================================================================

export interface BillInfo {
	billId: number;
	title: string;
	description: string | null;
	passed: boolean;
	loading: number[]; // Bill's loading on each latent dimension
	memberVariance: number; // How much members disagree on this bill
}

export interface MemberInfo {
	memberId: number;
	name: string;
	group: string | null;
	latentVector: number[];
}

export interface UserAnswer {
	billId: number;
	score: number; // -1 (oppose) to +1 (support), 0 = neutral/skip
}

export interface MatchingState {
	clusterId: number;
	clusterLabel: number;
	dimensions: number;
	answeredBills: UserAnswer[];
	userVector: number[]; // Estimated user position
	uncertainty: number[]; // Uncertainty per dimension
	questionCount: number;
}

export interface NextQuestion {
	bill: BillInfo;
	reason: string; // Why this bill was selected
	dimensionTarget: number; // Which dimension this primarily targets
}

export interface MatchResult {
	member: MemberInfo;
	similarity: number; // 0-1 cosine similarity
	rank: number;
}

export interface ClusterVectorData {
	memberVectors: Record<string, number[]>;
	memberNames: Record<string, string>;
	billLoadings: number[][]; // [billIndex][dimension]
	billIds: number[];
	explainedVariance: number[];
	dimensions: number;
	memberCount: number;
	billCount: number;
}

// ============================================================================
// Core Algorithm Functions
// ============================================================================

/**
 * Initialize a new matching session
 */
export function initializeMatchingState(
	clusterId: number,
	clusterLabel: number,
	dimensions: number
): MatchingState {
	return {
		clusterId,
		clusterLabel,
		dimensions,
		answeredBills: [],
		userVector: new Array(dimensions).fill(0),
		uncertainty: new Array(dimensions).fill(1.0), // Start with max uncertainty
		questionCount: 0
	};
}

/**
 * Estimate user's latent vector from their answers using weighted least squares
 *
 * Given:
 * - User answers: [(billId, score), ...]
 * - Bill loadings: v_b for each bill
 *
 * We solve: z_user = argmin Σ (score_b - z_user · v_b)²
 *
 * This is a linear least squares problem: V @ z = scores
 * Solution: z = (V^T V)^-1 V^T scores
 */
export function estimateUserVector(
	answers: UserAnswer[],
	billLoadings: Map<number, number[]>,
	dimensions: number
): { vector: number[]; uncertainty: number[] } {
	if (answers.length === 0) {
		return {
			vector: new Array(dimensions).fill(0),
			uncertainty: new Array(dimensions).fill(1.0)
		};
	}

	// Build design matrix V (n_answers x dimensions)
	const V: number[][] = [];
	const scores: number[] = [];

	for (const answer of answers) {
		const loading = billLoadings.get(answer.billId);
		if (loading) {
			V.push(loading);
			scores.push(answer.score);
		}
	}

	if (V.length === 0) {
		return {
			vector: new Array(dimensions).fill(0),
			uncertainty: new Array(dimensions).fill(1.0)
		};
	}

	// Compute V^T V (dimensions x dimensions)
	const VtV: number[][] = [];
	for (let i = 0; i < dimensions; i++) {
		VtV.push(new Array(dimensions).fill(0));
		for (let j = 0; j < dimensions; j++) {
			for (let k = 0; k < V.length; k++) {
				VtV[i][j] += V[k][i] * V[k][j];
			}
		}
	}

	// Compute V^T scores (dimensions x 1)
	const VtS: number[] = new Array(dimensions).fill(0);
	for (let i = 0; i < dimensions; i++) {
		for (let k = 0; k < V.length; k++) {
			VtS[i] += V[k][i] * scores[k];
		}
	}

	// Add regularization to avoid singularity
	const lambda = 0.01;
	for (let i = 0; i < dimensions; i++) {
		VtV[i][i] += lambda;
	}

	// Solve using simple Gaussian elimination (for small dimensions)
	const userVector = solveLinearSystem(VtV, VtS);

	// Estimate uncertainty: inverse of diagonal of V^T V
	// Higher values in V^T V diagonal = more information about that dimension
	const uncertainty: number[] = [];
	for (let i = 0; i < dimensions; i++) {
		// Uncertainty is inversely related to how much information we have
		const info = VtV[i][i];
		uncertainty.push(1.0 / Math.max(info, 0.1));
	}

	// Normalize uncertainty to [0, 1]
	const maxUncert = Math.max(...uncertainty);
	for (let i = 0; i < uncertainty.length; i++) {
		uncertainty[i] /= maxUncert;
	}

	return { vector: userVector, uncertainty };
}

/**
 * Solve linear system Ax = b using Gaussian elimination
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
	const n = b.length;
	const augmented: number[][] = A.map((row, i) => [...row, b[i]]);

	// Forward elimination
	for (let i = 0; i < n; i++) {
		// Find pivot
		let maxRow = i;
		for (let k = i + 1; k < n; k++) {
			if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
				maxRow = k;
			}
		}
		[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

		// Eliminate column
		for (let k = i + 1; k < n; k++) {
			if (augmented[i][i] !== 0) {
				const factor = augmented[k][i] / augmented[i][i];
				for (let j = i; j <= n; j++) {
					augmented[k][j] -= factor * augmented[i][j];
				}
			}
		}
	}

	// Back substitution
	const x = new Array(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		x[i] = augmented[i][n];
		for (let j = i + 1; j < n; j++) {
			x[i] -= augmented[i][j] * x[j];
		}
		if (augmented[i][i] !== 0) {
			x[i] /= augmented[i][i];
		}
	}

	return x;
}

/**
 * Select the next best question to ask
 *
 * Strategy:
 * 1. Find dimensions with highest uncertainty
 * 2. Find bills that have high loading on uncertain dimensions
 * 3. Prefer bills where members have high variance (controversial)
 * 4. Avoid bills already answered
 */
export function selectNextQuestion(
	state: MatchingState,
	clusterData: ClusterVectorData,
	billInfoMap: Map<number, BillInfo>
): NextQuestion | null {
	const answeredBillIds = new Set(state.answeredBills.map((a) => a.billId));

	// Calculate member variance for each bill
	const memberVectors = Object.values(clusterData.memberVectors);

	// Score each unanswered bill
	const billScores: { billId: number; score: number; reason: string; targetDim: number }[] = [];

	for (let idx = 0; idx < clusterData.billIds.length; idx++) {
		const billId = clusterData.billIds[idx];

		if (answeredBillIds.has(billId)) continue;

		const loading = clusterData.billLoadings[idx];
		if (!loading) continue;

		// Calculate information gain score
		// Higher loading on uncertain dimensions = more valuable
		let uncertaintyScore = 0;
		let maxDim = 0;
		let maxDimScore = 0;

		for (let d = 0; d < state.dimensions; d++) {
			const contribution = Math.abs(loading[d]) * state.uncertainty[d];
			uncertaintyScore += contribution;
			if (contribution > maxDimScore) {
				maxDimScore = contribution;
				maxDim = d;
			}
		}

		// Calculate member variance on this bill (from their projected scores)
		// Project each member's vector onto the bill loading direction
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

		// Combined score: uncertainty reduction × controversy
		const combinedScore = uncertaintyScore * (1 + Math.sqrt(variance));

		const reason = `次元${maxDim + 1}の不確実性を解消（議員間分散: ${variance.toFixed(2)}）`;

		billScores.push({
			billId,
			score: combinedScore,
			reason,
			targetDim: maxDim
		});
	}

	if (billScores.length === 0) {
		return null;
	}

	// Sort by score descending
	billScores.sort((a, b) => b.score - a.score);

	const best = billScores[0];
	const billInfo = billInfoMap.get(best.billId);

	if (!billInfo) {
		return null;
	}

	return {
		bill: billInfo,
		reason: best.reason,
		dimensionTarget: best.targetDim
	};
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;

	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) return 0;

	return dot / denom;
}

/**
 * Find members most similar to the user
 */
export function findMatchingMembers(
	userVector: number[],
	clusterData: ClusterVectorData,
	topK: number = 20
): MatchResult[] {
	const results: MatchResult[] = [];

	for (const [memberIdStr, memberVector] of Object.entries(clusterData.memberVectors)) {
		const memberId = parseInt(memberIdStr);
		const similarity = cosineSimilarity(userVector, memberVector);

		results.push({
			member: {
				memberId,
				name: clusterData.memberNames[memberIdStr] || `Member ${memberId}`,
				group: null, // Will be enriched later
				latentVector: memberVector
			},
			similarity,
			rank: 0
		});
	}

	// Sort by similarity descending
	results.sort((a, b) => b.similarity - a.similarity);

	// Assign ranks
	for (let i = 0; i < results.length; i++) {
		results[i].rank = i + 1;
	}

	return results.slice(0, topK);
}

/**
 * Update matching state with a new answer (or update an existing answer)
 */
export function updateMatchingState(
	state: MatchingState,
	answer: UserAnswer,
	billLoadings: Map<number, number[]>
): MatchingState {
	// Check if this bill was already answered - if so, update the answer
	const existingIndex = state.answeredBills.findIndex((a) => a.billId === answer.billId);
	let newAnswers: UserAnswer[];

	if (existingIndex >= 0) {
		// Update existing answer
		newAnswers = [...state.answeredBills];
		newAnswers[existingIndex] = answer;
	} else {
		// Add new answer
		newAnswers = [...state.answeredBills, answer];
	}

	const { vector, uncertainty } = estimateUserVector(newAnswers, billLoadings, state.dimensions);

	return {
		...state,
		answeredBills: newAnswers,
		userVector: vector,
		uncertainty,
		questionCount: state.questionCount + 1
	};
}

// ============================================================================
// Database Helper Functions
// ============================================================================

/**
 * Load bill information from database
 */
export async function loadBillInfo(billIds: number[]): Promise<Map<number, Partial<BillInfo>>> {
	if (billIds.length === 0) {
		return new Map();
	}

	const bills = await db
		.select({
			id: bill.id,
			passed: bill.passed,
			title: billDetail.title,
			description: billDetail.description
		})
		.from(bill)
		.leftJoin(billDetail, eq(bill.id, billDetail.billId))
		.where(inArray(bill.id, billIds));

	const map = new Map<number, Partial<BillInfo>>();
	for (const b of bills) {
		map.set(b.id, {
			billId: b.id,
			title: b.title || `法案 ${b.id}`,
			description: b.description,
			passed: b.passed || false
		});
	}

	return map;
}

/**
 * Load member group information
 */
export async function loadMemberGroups(memberIds: number[]): Promise<Map<number, string>> {
	if (memberIds.length === 0) {
		return new Map();
	}

	const membersWithGroups = await db
		.select({
			memberId: memberGroup.memberId,
			groupName: group.name
		})
		.from(memberGroup)
		.innerJoin(group, eq(memberGroup.groupId, group.id))
		.where(inArray(memberGroup.memberId, memberIds));

	// Get most recent group for each member (simplified - just take first)
	const map = new Map<number, string>();
	for (const mg of membersWithGroups) {
		if (!map.has(mg.memberId)) {
			map.set(mg.memberId, mg.groupName);
		}
	}

	return map;
}

/**
 * Build bill info map with loadings from cluster data
 */
export function buildBillInfoMap(
	clusterData: ClusterVectorData,
	dbBillInfo: Map<number, Partial<BillInfo>>
): Map<number, BillInfo> {
	const map = new Map<number, BillInfo>();

	for (let idx = 0; idx < clusterData.billIds.length; idx++) {
		const billId = clusterData.billIds[idx];
		const loading = clusterData.billLoadings[idx] || [];
		const dbInfo = dbBillInfo.get(billId) || {};

		// Calculate member variance for this bill
		const memberVectors = Object.values(clusterData.memberVectors);
		const projectedScores = memberVectors.map((mv) => {
			let proj = 0;
			for (let d = 0; d < loading.length; d++) {
				proj += mv[d] * loading[d];
			}
			return proj;
		});

		const mean =
			projectedScores.length > 0
				? projectedScores.reduce((a, b) => a + b, 0) / projectedScores.length
				: 0;
		const variance =
			projectedScores.length > 0
				? projectedScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / projectedScores.length
				: 0;

		map.set(billId, {
			billId,
			title: dbInfo.title || `法案 ${billId}`,
			description: dbInfo.description || null,
			passed: dbInfo.passed || false,
			loading,
			memberVariance: variance
		});
	}

	return map;
}
