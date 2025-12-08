import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { clusterVectorResults } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/cluster-vectors/[id]
 * Get a specific saved cluster vector result by ID
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const id = parseInt(params.id);

		if (isNaN(id)) {
			return json({ error: 'Invalid ID' }, { status: 400 });
		}

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
		console.error('Error fetching saved vector:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

/**
 * DELETE /api/cluster-vectors/[id]
 * Delete a specific saved cluster vector result by ID
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const id = parseInt(params.id);

		if (isNaN(id)) {
			return json({ error: 'Invalid ID' }, { status: 400 });
		}

		await db.delete(clusterVectorResults).where(eq(clusterVectorResults.id, id));

		return json({
			success: true,
			message: 'Saved vector deleted successfully'
		});
	} catch (error) {
		console.error('Error deleting saved vector:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
