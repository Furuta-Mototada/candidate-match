import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const response = await fetch('/api/stats');
		if (response.ok) {
			const data = await response.json();
			return { stats: data };
		}
	} catch {
		// Fall through to default
	}
	return {
		stats: { totalBills: 0, totalMembers: 0, totalVotes: 0, sessionsAnalyzed: 0 }
	};
};
