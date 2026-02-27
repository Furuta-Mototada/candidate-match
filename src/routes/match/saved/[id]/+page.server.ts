import type { PageServerLoad } from './$types.js';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}

	const snapshotId = params.id;

	const response = await fetch(`/api/saved-sessions?id=${snapshotId}`);
	const data = await response.json();

	if (!response.ok || !data.success) {
		throw error(404, 'スナップショットが見つかりません');
	}

	return {
		snapshot: data.snapshot
	};
};
