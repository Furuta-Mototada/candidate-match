import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db';
import { clusterVectorResults } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireIntParam, handleApiError } from '$lib/server/api-utils';

/**
 * GET /api/cluster-vectors/[id]
 * Get a specific saved cluster vector result by ID
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const id = requireIntParam(params.id, 'id');
		if (id instanceof Response) return id;

		const [result] = await db
			.select()
			.from(clusterVectorResults)
			.where(eq(clusterVectorResults.id, id));

		if (!result) {
			return json({ error: 'Saved vector not found' }, { status: 404 });
		}

		return json({
			success: true,
			data: result
		});
	} catch (error) {
		return handleApiError(error, 'Error fetching saved vector');
	}
};

/**
 * DELETE /api/cluster-vectors/[id]
 * Delete a specific saved cluster vector result by ID
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const id = requireIntParam(params.id, 'id');
		if (id instanceof Response) return id;

		await db.delete(clusterVectorResults).where(eq(clusterVectorResults.id, id));

		return json({
			success: true,
			message: 'Saved vector deleted successfully'
		});
	} catch (error) {
		return handleApiError(error, 'Error deleting saved vector');
	}
};
