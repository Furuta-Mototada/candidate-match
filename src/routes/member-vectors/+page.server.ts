import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { billClusters } from '$lib/server/db/schema.js';
import { desc } from 'drizzle-orm';

async function loadClusters() {
	return db.select().from(billClusters).orderBy(desc(billClusters.createdAt));
}

export const load: PageServerLoad = () => {
	return {
		clusters: loadClusters()
	};
};
