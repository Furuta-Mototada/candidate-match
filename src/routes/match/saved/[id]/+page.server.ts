import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, fetch }) => {
	const sessionId = params.id;

	const response = await fetch(`/api/saved-sessions?id=${sessionId}`);
	const data = await response.json();

	if (!response.ok || !data.success) {
		throw error(404, 'セッションが見つかりません');
	}

	return {
		session: data.session
	};
};
