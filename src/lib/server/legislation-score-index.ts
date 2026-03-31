import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Lazy-loaded, cached index of normalized legislation scores.
 * Maps memberId → billId → normalizedScore (float in [-1, 1]).
 *
 * Normalization is per-bill and sign-preserving:
 *   positive scores: score / billMax  → [0, 1]
 *   negative scores: score / |billMin| → [-1, 0]
 *   zero stays 0
 */

function normalizeScore(score: number, billMin: number, billMax: number): number {
	if (score > 0 && billMax > 0) return score / billMax;
	if (score < 0 && billMin < 0) return score / Math.abs(billMin);
	return 0;
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
		const allScores = bill.memberScores.map((ms) => ms.score);
		const billMax = allScores.length > 0 ? Math.max(...allScores) : 0;
		const billMin = allScores.length > 0 ? Math.min(...allScores) : 0;

		for (const ms of bill.memberScores) {
			let memberMap = scoreIndex.get(ms.memberId);
			if (!memberMap) {
				memberMap = new Map();
				scoreIndex.set(ms.memberId, memberMap);
			}
			memberMap.set(bill.billId, normalizeScore(ms.score, billMin, billMax));
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
