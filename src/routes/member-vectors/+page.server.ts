import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { billClusters } from '$lib/server/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Get all available clustering results for selection
	const clusters = await db.select().from(billClusters).orderBy(desc(billClusters.createdAt));

	return {
		clusters
	};
};
