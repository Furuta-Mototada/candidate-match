import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { billEmbeddings, bill, billDetail } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * GET /api/bill-embeddings
 * Get embeddings for visualization (optionally reduced to 2D/3D)
 * Query params:
 * - clusterId: Get 2D visualization data for specific cluster
 */
export const GET: RequestHandler = async ({ url }) => {
	const clusterId = url.searchParams.get('clusterId');

	try {
		if (clusterId) {
			// Generate 2D visualization for specific cluster
			const clusterIdNum = parseInt(clusterId);

			// Check if cluster-specific file already exists
			const clusterFile = `src/lib/data/bill_embeddings_2d_cluster_${clusterIdNum}.json`;

			try {
				// Try to read existing file first
				const existingData = await fs.readFile(clusterFile, 'utf-8');
				console.log(
					`✓ Serving cached visualization for cluster ${clusterIdNum} (${(existingData.length / 1024).toFixed(1)} KB)`
				);
				return json(JSON.parse(existingData));
			} catch (readError) {
				// File doesn't exist, generate it
				console.log(`⚠ Visualization file not found for cluster ${clusterIdNum}, generating...`);
				console.error('Read error:', readError);
				try {
					const startTime = Date.now();
					await execAsync(`python scripts/visualize_embeddings_2d.py ${clusterIdNum}`, {
						cwd: process.cwd()
					});
					const elapsed = Date.now() - startTime;
					console.log(`✓ Generated visualization in ${(elapsed / 1000).toFixed(1)}s`);

					// Read the generated file
					const vizData = await fs.readFile(clusterFile, 'utf-8');
					return json(JSON.parse(vizData));
				} catch (error) {
					console.error('Failed to generate visualization:', error);
					return json({ error: 'Failed to generate visualization' }, { status: 500 });
				}
			}
		}

		// Get all embeddings with bill details
		const embeddingsData = await db
			.select({
				billId: billEmbeddings.billId,
				embedding: billEmbeddings.embedding,
				embeddingModel: billEmbeddings.embeddingModel,
				billType: bill.type,
				submissionSession: bill.submissionSession,
				billNumber: bill.number,
				title: billDetail.title
			})
			.from(billEmbeddings)
			.leftJoin(bill, eq(billEmbeddings.billId, bill.id))
			.leftJoin(billDetail, eq(bill.id, billDetail.billId));

		// Parse embeddings from JSON strings
		const embeddings = embeddingsData.map((item) => ({
			billId: item.billId,
			embedding: JSON.parse(item.embedding as string),
			embeddingModel: item.embeddingModel,
			billType: item.billType,
			submissionSession: item.submissionSession,
			billNumber: item.billNumber,
			title: item.title
		}));

		return json({ embeddings });
	} catch (error) {
		console.error('Error fetching embeddings:', error);
		return json({ error: 'Failed to fetch embeddings' }, { status: 500 });
	}
};
