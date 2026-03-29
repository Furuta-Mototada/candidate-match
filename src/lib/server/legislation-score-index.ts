import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Lazy-loaded, cached index of normalized legislation scores.
 * Maps memberId → billId → normalizedScore (float in [-1, 1]).
 *
 * The raw scores from legislation_scores.json are normalized using:
 *   normalizedScore = 2 * (score - minScore) / (maxScore - minScore) - 1
 * where minScore = -10, maxScore = 12 (matching calculate_cluster_vectors.py).
 */

const MIN_SCORE = -10;
const MAX_SCORE = 12;

function normalizeScore(score: number): number {
	return (2.0 * (score - MIN_SCORE)) / (MAX_SCORE - MIN_SCORE) - 1.0;
}

// Cached index: memberId → Map<billId, normalizedScore>
let scoreIndex: Map<number, Map<number, number>> | null = null;

function loadIndex(): Map<number, Map<number, number>> {
	if (scoreIndex) return scoreIndex;

	const filePath = join(process.cwd(), 'static', 'data', 'legislation_scores.json');
	const raw = readFileSync(filePath, 'utf-8');
	const data: Array<{ billId: number; memberScores: Array<{ memberId: number; score: number }> }> =
		JSON.parse(raw);

	scoreIndex = new Map();

	for (const bill of data) {
		for (const ms of bill.memberScores) {
			let memberMap = scoreIndex.get(ms.memberId);
			if (!memberMap) {
				memberMap = new Map();
				scoreIndex.set(ms.memberId, memberMap);
			}
			memberMap.set(bill.billId, normalizeScore(ms.score));
		}
	}

	return scoreIndex;
}

/**
 * Get the normalized legislation score for a member on a specific bill.
 * Returns a number in [-1, 1] or null if no score exists.
 */
export function getMemberBillScore(memberId: number, billId: number): number | null {
	const index = loadIndex();
	return index.get(memberId)?.get(billId) ?? null;
}

/**
 * Get normalized legislation scores for a member across multiple bills.
 * Returns a Map<billId, normalizedScore>.
 */
export function getMemberBillScores(memberId: number, billIds: number[]): Map<number, number> {
	const index = loadIndex();
	const memberMap = index.get(memberId);
	const result = new Map<number, number>();
	if (!memberMap) return result;
	for (const billId of billIds) {
		const score = memberMap.get(billId);
		if (score !== undefined) {
			result.set(billId, score);
		}
	}
	return result;
}
