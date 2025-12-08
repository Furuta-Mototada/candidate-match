import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '$lib/server/db';
import {
	billClusters,
	billClusterAssignments,
	billClusterLabelNames,
	member
} from '$lib/server/db/schema';
import { eq, inArray } from 'drizzle-orm';

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
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { clusterId, clusterLabel, nComponents = 3 } = body;

		if (!clusterId) {
			return json({ error: 'clusterId is required' }, { status: 400 });
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

		return json({
			success: true,
			clusterId: result.clusterId,
			clusterName: clusterInfo.name,
			nComponents: result.nComponents,
			clusters: enrichedClusters
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
 * GET /api/cluster-vectors
 * Get available cluster labels for a specific clustering
 */
export const GET: RequestHandler = async ({ url }) => {
	const clusterId = url.searchParams.get('clusterId');

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

		return json({
			clusterId: clusterIdNum,
			clusterName: clusterInfo.name,
			algorithm: clusterInfo.algorithm,
			parameters: clusterInfo.parameters,
			clusterLabels
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
