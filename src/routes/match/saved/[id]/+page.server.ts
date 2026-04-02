import type { PageServerLoad } from './$types.js';
import { redirect } from '@sveltejs/kit';

async function loadSnapshot(fetch: typeof globalThis.fetch, snapshotId: string) {
	const response = await fetch(`/api/saved-sessions?id=${snapshotId}`);
	const data = await response.json();

	if (!response.ok || !data.success) {
		return { error: true, snapshot: null };
	}

	return { error: false, snapshot: data.snapshot };
}

export const load: PageServerLoad = ({ params, fetch, locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}

	return {
		streamed: loadSnapshot(fetch, params.id)
	};
};
