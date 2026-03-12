import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ fetch, locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/login');
	}

	const [snapshotsRes, answersRes, delegationsRes] = await Promise.all([
		fetch('/api/saved-sessions'),
		fetch('/api/saved-sessions?answers=true'),
		fetch('/api/delegations?action=all')
	]);

	const snapshotsData = await snapshotsRes.json();
	const answersData = await answersRes.json();
	const delegationsData = await delegationsRes.json();

	return {
		snapshots: snapshotsData.success ? snapshotsData.snapshots : [],
		totalAnswers: answersData.success ? answersData.totalAnswers : 0,
		answers: answersData.success ? answersData.answers : [],
		incomingDelegations: delegationsData.success ? delegationsData.incoming : [],
		outgoingDelegations: delegationsData.success ? delegationsData.outgoing : []
	};
};
