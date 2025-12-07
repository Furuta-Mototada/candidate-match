import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * POST /api/generate-clustering
 * Generate a new clustering by calling the Python script
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { algorithm, name, n_clusters, min_cluster_size, min_samples } = body;

		if (!algorithm || !name) {
			return json({ error: 'Missing required parameters' }, { status: 400 });
		}

		// Build command
		let command = `python3 scripts/cluster_bills.py ${algorithm} "${name}"`;

		if (algorithm === 'kmeans') {
			if (!n_clusters) {
				return json({ error: 'n_clusters is required for kmeans' }, { status: 400 });
			}
			command += ` ${n_clusters}`;
		} else if (algorithm === 'hdbscan') {
			command += ` ${min_cluster_size || 5}`;
			if (min_samples) {
				command += ` ${min_samples}`;
			}
		} else {
			return json({ error: 'Invalid algorithm' }, { status: 400 });
		}

		console.log('Executing:', command);

		// Execute clustering script
		const { stdout, stderr } = await execAsync(command, {
			env: process.env,
			maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
		});

		console.log('Script output:', stdout);
		if (stderr) {
			console.error('Script errors:', stderr);
		}

		// Parse cluster ID from output
		const clusterIdMatch = stdout.match(/Cluster ID: (\d+)/);
		const clusterId = clusterIdMatch ? parseInt(clusterIdMatch[1]) : null;

		return json({
			success: true,
			clusterId,
			output: stdout,
			message: 'Clustering generated successfully'
		});
	} catch (error: any) {
		console.error('Error generating clustering:', error);
		return json(
			{
				error: 'Failed to generate clustering',
				message: error.message,
				details: error.stderr || error.stdout
			},
			{ status: 500 }
		);
	}
};
