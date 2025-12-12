import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import {
	billClusters,
	billClusterAssignments,
	billClusterLabelNames,
	bill,
	billEmbeddings,
	billEnrichment,
	committee,
	committeeBill
} from '$lib/server/db/schema.js';
import { eq, desc, inArray, sql } from 'drizzle-orm';

/**
 * GET /api/bill-clusters
 * List all clustering results or get details of a specific cluster
 */
export const GET: RequestHandler = async ({ url }): Promise<Response> => {
	const clusterId = url.searchParams.get('id');

	try {
		if (clusterId) {
			// Get details of a specific cluster including all bills
			const clusterIdNum = parseInt(clusterId);

			// Get cluster metadata
			const [clusterInfo] = await db
				.select()
				.from(billClusters)
				.where(eq(billClusters.id, clusterIdNum));

			if (!clusterInfo) {
				return json({ error: 'Cluster not found' }, { status: 404 });
			}

			// Get all bills in this cluster with their details
			const assignments = await db
				.select({
					billId: billClusterAssignments.billId,
					clusterLabel: billClusterAssignments.clusterLabel,
					distance: billClusterAssignments.distance,
					billType: bill.type,
					submissionSession: bill.submissionSession,
					billNumber: bill.number,
					title: bill.title,
					description: billEnrichment.summaryShort,
					pdfUrl: billEmbeddings.pdfUrl,
					result: bill.result
				})
				.from(billClusterAssignments)
				.leftJoin(bill, eq(billClusterAssignments.billId, bill.id))
				.leftJoin(billEnrichment, eq(bill.id, billEnrichment.billId))
				.leftJoin(billEmbeddings, eq(bill.id, billEmbeddings.billId))
				.where(eq(billClusterAssignments.clusterId, clusterIdNum)); // Get committee assignments for all bills
			const billIds = assignments.map((a) => a.billId);

			const committees =
				billIds.length > 0
					? await db
							.select({
								billId: committeeBill.billId,
								committeeName: committee.name,
								chamber: committee.chamber,
								session: committeeBill.session
							})
							.from(committeeBill)
							.leftJoin(committee, eq(committeeBill.committeeId, committee.id))
							.where(inArray(committeeBill.billId, billIds))
					: [];

			// Organize bills by cluster label
			interface BillWithDetails {
				billId: number;
				clusterLabel: number;
				distance: string | null;
				billType: string | null;
				submissionSession: number | null;
				billNumber: number | null;
				title: string | null;
				description: string | null;
				result: string | null;
				pdfUrl: string | null;
				committees: Array<{ name: string | null; chamber: string | null; session: number }>;
			}

			const billsByCluster: Record<number, BillWithDetails[]> = {};
			for (const assignment of assignments) {
				const label = assignment.clusterLabel;
				if (!billsByCluster[label]) {
					billsByCluster[label] = [];
				}

				// Find committees for this bill
				const billCommittees = committees.filter((c) => c.billId === assignment.billId);

				billsByCluster[label].push({
					billId: assignment.billId,
					clusterLabel: assignment.clusterLabel,
					distance: assignment.distance,
					billType: assignment.billType,
					submissionSession: assignment.submissionSession,
					billNumber: assignment.billNumber,
					title: assignment.title,
					description: assignment.description,
					result: assignment.result,
					pdfUrl: assignment.pdfUrl,
					committees: billCommittees.map((c) => ({
						name: c.committeeName,
						chamber: c.chamber,
						session: c.session
					}))
				});
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

			return json({
				cluster: clusterInfo,
				billsByCluster,
				labelNames: labelNameMap,
				totalBills: assignments.length
			});
		} else {
			// List all clusters with bill counts in a single optimized query
			const clusters = await db.select().from(billClusters).orderBy(desc(billClusters.createdAt));

			// Get counts for all clusters in one query using sql
			const counts = await db
				.select({
					clusterId: billClusterAssignments.clusterId,
					count: sql<number>`count(*)::int`
				})
				.from(billClusterAssignments)
				.groupBy(billClusterAssignments.clusterId);

			// Create a map for fast lookup
			const countMap = new Map(counts.map((c) => [c.clusterId, c.count]));

			// Combine clusters with their counts
			const clustersWithCounts = clusters.map((cluster) => ({
				...cluster,
				billCount: countMap.get(cluster.id) || 0
			}));

			return json({ clusters: clustersWithCounts });
		}
	} catch (error) {
		console.error('Error fetching clusters:', error);
		return json({ error: 'Failed to fetch clusters' }, { status: 500 });
	}
};
