import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { billClusters } from '$lib/server/db/schema.js';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Get all available clustering results for selection
	const clusters = await db.select().from(billClusters).orderBy(desc(billClusters.createdAt));

	return {
		clusters
	};
};
