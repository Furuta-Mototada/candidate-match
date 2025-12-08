import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const response = await fetch('/api/match');
		if (!response.ok) {
			console.error('Failed to fetch clusters for matching');
			return { clusters: [] };
		}

		const data = await response.json();
		return {
			clusters: data.clusters || []
		};
	} catch (error) {
		console.error('Error loading match page data:', error);
		return { clusters: [] };
	}
};
