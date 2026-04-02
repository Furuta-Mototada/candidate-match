import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

async function loadPageData(fetch: typeof globalThis.fetch) {
	const [snapshotsRes, answersRes, matchRes] = await Promise.all([
		fetch('/api/saved-sessions'),
		fetch('/api/saved-sessions?answers=true'),
		fetch('/api/match')
	]);

	const snapshotsData = await snapshotsRes.json();
	const answersData = await answersRes.json();
	const matchData = await matchRes.json();

	return {
		snapshots: snapshotsData.success ? snapshotsData.snapshots : [],
		totalAnswers: answersData.success ? answersData.totalAnswers : 0,
		answers: answersData.success ? answersData.answers : [],
		savedVectors: matchData.success ? matchData.savedVectors : []
	};
}

export const load: PageServerLoad = ({ fetch, locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}

	return {
		streamed: loadPageData(fetch)
	};
};
