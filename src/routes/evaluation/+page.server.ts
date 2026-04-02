import type { PageServerLoad } from './$types.js';

async function loadSavedVectors(fetch: typeof globalThis.fetch) {
	try {
		const response = await fetch('/api/evaluation');
		if (!response.ok) {
			return [];
		}
		const data = await response.json();
		return data.savedVectors || [];
	} catch {
		return [];
	}
}

export const load: PageServerLoad = ({ fetch }) => {
	return {
		savedVectors: loadSavedVectors(fetch)
	};
};
