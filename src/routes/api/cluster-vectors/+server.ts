import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '$lib/server/db';
import {
	billClusters,
	billClusterAssignments,
	billClusterLabelNames,
	clusterVectorResults,
	member
} from '$lib/server/db/schema';
import { eq, inArray, desc } from 'drizzle-orm';

const execAsync = promisify(exec);

interface ClusterVectorResult {
	memberVectors: Record<string, number[]>;
	billLoadings: number[][];
	representativeBills: Array<
		Array<{
			billId: number;
			title: string;
			passed: boolean;
			loading: number;
			absLoading: number;
		}>
	>;
	explainedVariance: number[];
	dimensions: number;
	memberCount: number;
	billCount: number;
	billIds: number[];
}

interface CalculationResult {
	clusterId: number;
	nComponents: number;
	clusters: Record<string, ClusterVectorResult>;
}

/**
 * POST /api/cluster-vectors
 * Calculate cluster-specific member vectors using weighted PCA/SVD
 * If saveImmediately is true and saveName is provided, saves all calculated clusters to the database
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { clusterId, clusterLabel, nComponents = 3, saveImmediately = false, saveName } = body;

		if (!clusterId) {
			return json({ error: 'clusterId is required' }, { status: 400 });
		}

		if (saveImmediately && !saveName) {
			return json({ error: 'saveName is required when saveImmediately is true' }, { status: 400 });
		}

		// Verify cluster exists
		const [clusterInfo] = await db
			.select()
			.from(billClusters)
			.where(eq(billClusters.id, clusterId));

		if (!clusterInfo) {
			return json({ error: 'Cluster not found' }, { status: 404 });
		}

		// Build command
		let cmd = `python scripts/calculate_cluster_vectors.py --cluster-id ${clusterId} --n-components ${nComponents}`;
		if (clusterLabel !== undefined) {
			cmd += ` --cluster-label ${clusterLabel}`;
		}

		console.log(`Executing: ${cmd}`);

		const { stdout, stderr } = await execAsync(cmd, {
			cwd: process.cwd(),
			env: process.env,
			maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large outputs
		});

		if (stderr) {
			console.log('Cluster vector calculation stderr:', stderr);
		}

		// Parse the JSON output from stdout (last line or full output)
		const lines = stdout.trim().split('\n');

		// Find the JSON output (starts with '{')
		let jsonOutput = '';
		let inJson = false;
		for (const line of lines) {
			if (line.startsWith('{')) {
				inJson = true;
			}
			if (inJson) {
				jsonOutput += line;
			}
		}

		if (!jsonOutput) {
			throw new Error('No JSON output from calculation script');
		}

		const result: CalculationResult = JSON.parse(jsonOutput);

		// Enrich with member names
		const allMemberIds = new Set<number>();
		for (const cluster of Object.values(result.clusters)) {
			for (const memberId of Object.keys(cluster.memberVectors)) {
				allMemberIds.add(parseInt(memberId));
			}
		}

		const memberIdList = Array.from(allMemberIds);
		const members =
			memberIdList.length > 0
				? await db.select().from(member).where(inArray(member.id, memberIdList))
				: [];

		const memberNameMap = new Map(members.map((m) => [m.id, m.name]));

		// Add member names to the result
		const enrichedClusters: Record<
			string,
			ClusterVectorResult & { memberNames: Record<string, string> }
		> = {};

		for (const [label, cluster] of Object.entries(result.clusters)) {
			const memberNames: Record<string, string> = {};
			for (const memberId of Object.keys(cluster.memberVectors)) {
				memberNames[memberId] = memberNameMap.get(parseInt(memberId)) || `Member ${memberId}`;
			}
			enrichedClusters[label] = {
				...cluster,
				memberNames
			};
		}

		// Auto-save if requested
		let savedCount = 0;
		if (saveImmediately && saveName) {
			for (const [label, clusterData] of Object.entries(enrichedClusters)) {
				try {
					await db.insert(clusterVectorResults).values({
						clusterId,
						clusterLabel: parseInt(label),
						nComponents,
						name: saveName,
						memberVectors: JSON.stringify(clusterData.memberVectors),
						memberNames: JSON.stringify(clusterData.memberNames),
						billLoadings: JSON.stringify(clusterData.billLoadings),
						billIds: JSON.stringify(clusterData.billIds),
						explainedVariance: JSON.stringify(clusterData.explainedVariance),
						dimensions: clusterData.dimensions,
						memberCount: clusterData.memberCount,
						billCount: clusterData.billCount,
						representativeBills: clusterData.representativeBills
							? JSON.stringify(clusterData.representativeBills)
							: null
					});
					savedCount++;
				} catch (saveError) {
					console.error(`Error saving cluster label ${label}:`, saveError);
				}
			}
		}

		return json({
			success: true,
			clusterId: result.clusterId,
			clusterName: clusterInfo.name,
			nComponents: result.nComponents,
			clusters: enrichedClusters,
			savedCount: saveImmediately ? savedCount : undefined,
			savedName: saveImmediately ? saveName : undefined
		});
	} catch (error) {
		console.error('Error calculating cluster vectors:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

/**
 * PUT /api/cluster-vectors
 * Save calculated cluster vectors to the database for later use in matching
 */
export const PUT: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { clusterId, clusterLabel, nComponents, name, clusterData } = body;

		if (!clusterId || clusterLabel === undefined || !nComponents || !name || !clusterData) {
			return json(
				{ error: 'clusterId, clusterLabel, nComponents, name, and clusterData are required' },
				{ status: 400 }
			);
		}

		// Verify cluster exists
		const [clusterInfo] = await db
			.select()
			.from(billClusters)
			.where(eq(billClusters.id, clusterId));

		if (!clusterInfo) {
			return json({ error: 'Cluster not found' }, { status: 404 });
		}

		// Insert into database
		const [inserted] = await db
			.insert(clusterVectorResults)
			.values({
				clusterId,
				clusterLabel,
				nComponents,
				name,
				memberVectors: JSON.stringify(clusterData.memberVectors),
				memberNames: JSON.stringify(clusterData.memberNames),
				billLoadings: JSON.stringify(clusterData.billLoadings),
				billIds: JSON.stringify(clusterData.billIds),
				explainedVariance: JSON.stringify(clusterData.explainedVariance),
				dimensions: clusterData.dimensions,
				memberCount: clusterData.memberCount,
				billCount: clusterData.billCount,
				representativeBills: clusterData.representativeBills
					? JSON.stringify(clusterData.representativeBills)
					: null
			})
			.returning({ id: clusterVectorResults.id });

		return json({
			success: true,
			id: inserted.id,
			message: 'Cluster vectors saved successfully'
		});
	} catch (error) {
		console.error('Error saving cluster vectors:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

/**
 * GET /api/cluster-vectors
 * Get available cluster labels for a specific clustering, or list saved vector results
 * Query params:
 * - clusterId: the clustering configuration to query (optional if all=true)
 * - saved: optional - if "true", return saved vector results instead of available labels
 * - all: optional - if "true", return all saved results across all clusters
 */
export const GET: RequestHandler = async ({ url }) => {
	const clusterId = url.searchParams.get('clusterId');
	const savedParam = url.searchParams.get('saved');
	const allParam = url.searchParams.get('all');

	// If requesting all saved results
	if (savedParam === 'true' && allParam === 'true') {
		try {
			const savedResults = await db
				.select({
					id: clusterVectorResults.id,
					clusterId: clusterVectorResults.clusterId,
					clusterLabel: clusterVectorResults.clusterLabel,
					nComponents: clusterVectorResults.nComponents,
					name: clusterVectorResults.name,
					dimensions: clusterVectorResults.dimensions,
					memberCount: clusterVectorResults.memberCount,
					billCount: clusterVectorResults.billCount,
					createdAt: clusterVectorResults.createdAt
				})
				.from(clusterVectorResults)
				.orderBy(desc(clusterVectorResults.createdAt));

			return json({
				success: true,
				savedResults
			});
		} catch (error) {
			console.error('Error fetching all saved vectors:', error);
			return json(
				{ error: error instanceof Error ? error.message : 'Unknown error' },
				{ status: 500 }
			);
		}
	}

	if (!clusterId) {
		return json({ error: 'clusterId is required' }, { status: 400 });
	}

	try {
		const clusterIdNum = parseInt(clusterId);

		// Get cluster info
		const [clusterInfo] = await db
			.select()
			.from(billClusters)
			.where(eq(billClusters.id, clusterIdNum));

		if (!clusterInfo) {
			return json({ error: 'Cluster not found' }, { status: 404 });
		}

		// If requesting saved results
		if (savedParam === 'true') {
			const savedResults = await db
				.select({
					id: clusterVectorResults.id,
					clusterLabel: clusterVectorResults.clusterLabel,
					nComponents: clusterVectorResults.nComponents,
					name: clusterVectorResults.name,
					dimensions: clusterVectorResults.dimensions,
					memberCount: clusterVectorResults.memberCount,
					billCount: clusterVectorResults.billCount,
					createdAt: clusterVectorResults.createdAt
				})
				.from(clusterVectorResults)
				.where(eq(clusterVectorResults.clusterId, clusterIdNum))
				.orderBy(desc(clusterVectorResults.createdAt));

			return json({
				clusterId: clusterIdNum,
				clusterName: clusterInfo.name,
				savedResults
			});
		}

		// Get unique cluster labels and bill counts
		const assignments = await db
			.select({
				clusterLabel: billClusterAssignments.clusterLabel,
				billId: billClusterAssignments.billId
			})
			.from(billClusterAssignments)
			.where(eq(billClusterAssignments.clusterId, clusterIdNum));

		// Count bills per cluster label
		const labelCounts: Record<number, number> = {};
		for (const assignment of assignments) {
			labelCounts[assignment.clusterLabel] = (labelCounts[assignment.clusterLabel] || 0) + 1;
		}

		// Get cluster label names
		const labelNames = await db
			.select({
				clusterLabel: billClusterLabelNames.clusterLabel,
				name: billClusterLabelNames.name,
				description: billClusterLabelNames.description
			})
			.from(billClusterLabelNames)
			.where(eq(billClusterLabelNames.clusterId, clusterIdNum));

		const labelNameMap: Record<number, { name: string; description: string | null }> = {};
		for (const ln of labelNames) {
			labelNameMap[ln.clusterLabel] = { name: ln.name, description: ln.description };
		}

		const clusterLabels = Object.entries(labelCounts)
			.map(([label, count]) => ({
				label: parseInt(label),
				billCount: count,
				name: labelNameMap[parseInt(label)]?.name || null,
				description: labelNameMap[parseInt(label)]?.description || null
			}))
			.sort((a, b) => a.label - b.label);

		// Also get saved results count for each label
		const savedResults = await db
			.select({
				id: clusterVectorResults.id,
				clusterLabel: clusterVectorResults.clusterLabel,
				nComponents: clusterVectorResults.nComponents,
				name: clusterVectorResults.name,
				dimensions: clusterVectorResults.dimensions,
				memberCount: clusterVectorResults.memberCount,
				billCount: clusterVectorResults.billCount,
				createdAt: clusterVectorResults.createdAt
			})
			.from(clusterVectorResults)
			.where(eq(clusterVectorResults.clusterId, clusterIdNum))
			.orderBy(desc(clusterVectorResults.createdAt));

		return json({
			clusterId: clusterIdNum,
			clusterName: clusterInfo.name,
			algorithm: clusterInfo.algorithm,
			parameters: clusterInfo.parameters,
			clusterLabels,
			savedResults
		});
	} catch (error) {
		console.error('Error fetching cluster labels:', error);
		return json(
			{
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
