import type { PageServerLoad } from './$types.js';

async function loadSavedVectors(fetch: typeof globalThis.fetch) {
	try {
		const response = await fetch('/api/match');
		if (!response.ok) {
			console.error('Failed to fetch data for matching');
			return [];
		}

		const data = await response.json();
		return data.savedVectors || [];
	} catch (error) {
		console.error('Error loading match page data:', error);
		return [];
	}
}

export const load: PageServerLoad = ({ fetch }) => {
	return {
		savedVectors: loadSavedVectors(fetch)
	};
};
