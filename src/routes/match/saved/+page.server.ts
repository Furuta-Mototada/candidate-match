import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch, locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}

	const response = await fetch('/api/saved-sessions');
	const data = await response.json();

	return {
		sessions: data.success ? data.sessions : []
	};
};
