import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch }) => {
	const response = await fetch('/api/saved-sessions');
	const data = await response.json();

	return {
		sessions: data.success ? data.sessions : []
	};
};
