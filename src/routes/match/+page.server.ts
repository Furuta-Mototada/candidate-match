import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const response = await fetch('/api/match');
		if (!response.ok) {
			console.error('Failed to fetch data for matching');
			return { savedVectors: [] };
		}

		const data = await response.json();
		return {
			savedVectors: data.savedVectors || []
		};
	} catch (error) {
		console.error('Error loading match page data:', error);
		return { savedVectors: [] };
	}
};
