import type { PageServerLoad } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { billClusters, billEmbeddings } from '$lib/server/db/schema.js';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Get all available clustering results
	const clusters = await db.select().from(billClusters).orderBy(desc(billClusters.createdAt));

	// Get count of bills with embeddings
	const [embeddingCount] = await db
		.select({
			count: billEmbeddings.billId
		})
		.from(billEmbeddings);

	return {
		clusters,
		embeddingCount: embeddingCount?.count || 0
	};
};
