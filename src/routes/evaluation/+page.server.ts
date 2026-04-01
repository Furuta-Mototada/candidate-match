import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const response = await fetch('/api/evaluation');
		if (!response.ok) {
			return { savedVectors: [] };
		}
		const data = await response.json();
		return { savedVectors: data.savedVectors || [] };
	} catch {
		return { savedVectors: [] };
	}
};
