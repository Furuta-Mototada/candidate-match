import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { billEmbeddings, bill, billClusterAssignments } from '$lib/server/db/schema.js';
import { eq, isNotNull, and } from 'drizzle-orm';
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
export const GET: RequestHandler = async ({ url }): Promise<Response> => {
	const clusterId = url.searchParams.get('clusterId');

	try {
		if (clusterId) {
			const clusterIdNum = parseInt(clusterId);
			const clusterFile = `static/data/bill_embeddings_2d_cluster_${clusterIdNum}.json`;

			// First, try JSON file cache (fastest)
			try {
				const existingData = await fs.readFile(clusterFile, 'utf-8');
				console.log(
					`✓ Serving cached visualization for cluster ${clusterIdNum} (${(existingData.length / 1024).toFixed(1)} KB)`
				);
				return json(JSON.parse(existingData));
			} catch {
				// JSON file doesn't exist, try database
			}

			// Fallback: try database (source of truth)
			const dbData = await db
				.select({
					billId: billClusterAssignments.billId,
					clusterLabel: billClusterAssignments.clusterLabel,
					x: billClusterAssignments.x,
					y: billClusterAssignments.y,
					type: bill.type,
					session: bill.submissionSession,
					number: bill.number,
					title: bill.title
				})
				.from(billClusterAssignments)
				.leftJoin(bill, eq(billClusterAssignments.billId, bill.id))
				.where(
					and(
						eq(billClusterAssignments.clusterId, clusterIdNum),
						isNotNull(billClusterAssignments.x),
						isNotNull(billClusterAssignments.y)
					)
				);

			if (dbData.length > 0) {
				// Return data from database
				const vizData = dbData.map((row) => ({
					billId: row.billId,
					type: row.type,
					session: row.session,
					number: row.number,
					title: row.title || 'Untitled',
					x: row.x,
					y: row.y,
					cluster: row.clusterLabel
				}));
				console.log(
					`✓ Serving visualization from database for cluster ${clusterIdNum} (${vizData.length} bills)`
				);
				return json(vizData);
			}

			// Last resort: generate it (this will update both database and JSON file)
			console.log(`⚠ Visualization not found for cluster ${clusterIdNum}, generating...`);
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

		// Get all embeddings with bill details
		const embeddingsData = await db
			.select({
				billId: billEmbeddings.billId,
				embedding: billEmbeddings.embedding,
				embeddingModel: billEmbeddings.embeddingModel,
				billType: bill.type,
				submissionSession: bill.submissionSession,
				billNumber: bill.number,
				title: bill.title
			})
			.from(billEmbeddings)
			.leftJoin(bill, eq(billEmbeddings.billId, bill.id));

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
