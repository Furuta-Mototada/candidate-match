import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

async function loadFriendsData(fetch: typeof globalThis.fetch) {
	const [friendsRes, requestsRes] = await Promise.all([
		fetch('/api/friends?action=list'),
		fetch('/api/friends?action=requests')
	]);

	const [friendsData, requestsData] = await Promise.all([friendsRes.json(), requestsRes.json()]);

	return {
		friends: friendsData.friends ?? [],
		incoming: requestsData.incoming ?? [],
		outgoing: requestsData.outgoing ?? []
	};
}

export const load: PageServerLoad = ({ locals, fetch }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login?redirect=/friends');
	}

	return {
		streamed: loadFriendsData(fetch)
	};
};
