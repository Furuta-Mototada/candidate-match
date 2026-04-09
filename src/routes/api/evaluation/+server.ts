import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { clusterVectorResults, evaluationRun } from '$lib/server/db/schema.js';
import { eq, and, gte } from 'drizzle-orm';
import { runEvaluation, type StrategyName } from '$lib/server/matching-evaluation.js';
import type { ClusterVectorData } from '$lib/server/matching.js';
import { requireUser, isErrorResponse, handleApiError } from '$lib/server/api-utils.js';

/** Maximum evaluation runs per user within the rate limit window */
const MAX_EVALS_PER_WINDOW = 3;
/** Rate limit window in milliseconds (1 hour) */
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/evaluation
 *
 * Run adaptive question selection evaluation.
 * Requires authentication. Rate-limited to prevent abuse.
 * Body: { savedVectorId, maxQuestions?, sampleSize?, convergeThreshold?, strategies? }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userOrError = requireUser(locals);
	if (isErrorResponse(userOrError)) return userOrError;
	const currentUser = userOrError;

	try {
		// Rate limit check
		const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
		const recentRuns = await db
			.select({ id: evaluationRun.id })
			.from(evaluationRun)
			.where(
				and(eq(evaluationRun.userId, currentUser.id), gte(evaluationRun.createdAt, windowStart))
			);

		if (recentRuns.length >= MAX_EVALS_PER_WINDOW) {
			return json(
				{
					error: `評価の実行は1時間に${MAX_EVALS_PER_WINDOW}回までです。しばらく待ってからお試しください。`
				},
				{ status: 429 }
			);
		}

		const body = await request.json();
		const { savedVectorId, maxQuestions, sampleSize, convergeThreshold, strategies } = body;

		if (!savedVectorId) {
			return json({ error: 'savedVectorId is required' }, { status: 400 });
		}

		// Load saved vector data
		const [savedResult] = await db
			.select()
			.from(clusterVectorResults)
			.where(eq(clusterVectorResults.id, savedVectorId));

		if (!savedResult) {
			return json({ error: 'Saved vector result not found' }, { status: 404 });
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

		// Validate strategies if provided
		const validStrategies: StrategyName[] = ['cat', 'random', 'controversial'];
		if (strategies) {
			for (const s of strategies) {
				if (!validStrategies.includes(s)) {
					return json({ error: `Invalid strategy: ${s}` }, { status: 400 });
				}
			}
		}

		const result = await runEvaluation(clusterData, savedResult.clusterLabel, {
			maxQuestions: maxQuestions ?? 20,
			sampleSize: sampleSize ?? 10,
			convergeThreshold: convergeThreshold ?? 0.2,
			strategies: strategies ?? validStrategies
		});

		// Record this evaluation run for rate limiting
		await db.insert(evaluationRun).values({ userId: currentUser.id });

		return json({
			success: true,
			result: {
				aggregated: result.aggregated,
				memberCount: result.memberCount,
				billCount: result.billCount,
				dimensions: result.dimensions,
				clusterLabel: result.clusterLabel,
				sampleMemberIds: result.sampleMemberIds,
				// Include per-member results but limit to keep payload reasonable
				perMember: result.strategies.map((s) => ({
					strategy: s.strategy,
					memberId: s.memberId,
					memberName: s.memberName,
					finalCosineError: s.steps.length > 0 ? s.steps[s.steps.length - 1].cosineError : null,
					finalRank: s.steps.length > 0 ? s.steps[s.steps.length - 1].trueRank : null,
					steps: s.steps
				}))
			}
		});
	} catch (error) {
		return handleApiError(error, 'Evaluation API error');
	}
};

/**
 * GET /api/evaluation
 *
 * List available saved vector configs for evaluation.
 */
export const GET: RequestHandler = async () => {
	try {
		const savedVectors = await db
			.select({
				id: clusterVectorResults.id,
				clusterId: clusterVectorResults.clusterId,
				clusterLabel: clusterVectorResults.clusterLabel,
				name: clusterVectorResults.name,
				dimensions: clusterVectorResults.dimensions,
				memberCount: clusterVectorResults.memberCount,
				billCount: clusterVectorResults.billCount,
				isDefault: clusterVectorResults.isDefault,
				createdAt: clusterVectorResults.createdAt
			})
			.from(clusterVectorResults)
			.orderBy(clusterVectorResults.createdAt);

		return json({ savedVectors });
	} catch (error) {
		return handleApiError(error, 'Evaluation GET error');
	}
};
