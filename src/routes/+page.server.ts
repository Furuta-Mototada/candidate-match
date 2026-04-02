import type { PageServerLoad } from './$types.js';

async function loadStats(fetch: typeof globalThis.fetch) {
	try {
		const response = await fetch('/api/stats');
		if (response.ok) {
			return await response.json();
		}
	} catch {
		// Fall through to default
	}
	return { totalBills: 0, totalMembers: 0, totalVotes: 0, sessionsAnalyzed: 0 };
}

export const load: PageServerLoad = ({ fetch }) => {
	return {
		stats: loadStats(fetch)
	};
};
