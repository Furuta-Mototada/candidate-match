import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculatePartyScores } from '$lib/server/party-matching.js';
import { handleApiError } from '$lib/server/api-utils.js';

/**
 * POST /api/party-match
 *
 * Computes party matching scores from member similarity data.
 * Returns both "current roster" and "historical actions" modes.
 *
 * Body: {
 *   clusterResults: Array<{
 *     clusterLabel: number;
 *     importance: number;
 *     matches: Array<{ memberId: number; name: string; group: string | null; similarity: number }>;
 *   }>;
 *   vectorGroupKey?: string; // Required for historical mode
 * }
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { clusterResults, vectorGroupKey } = body;

		if (!clusterResults || !Array.isArray(clusterResults)) {
			return json({ error: 'clusterResults is required' }, { status: 400 });
		}

		const partyScores = await calculatePartyScores(clusterResults, vectorGroupKey || null);

		return json({
			success: true,
			partyScores
		});
	} catch (error) {
		return handleApiError(error, 'Party match API error');
	}
};
