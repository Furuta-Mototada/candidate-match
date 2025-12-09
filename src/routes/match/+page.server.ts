import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({
	fetch,
	url
}): Promise<{
	savedVectors: unknown[];
	resumeSessionId: number | null;
	resumeSession: unknown | null;
}> => {
	try {
		const response = await fetch('/api/match');
		if (!response.ok) {
			console.error('Failed to fetch data for matching');
			return { savedVectors: [], resumeSessionId: null, resumeSession: null };
		}

		const data = await response.json();

		// Check if we're resuming a session
		const resumeParam = url.searchParams.get('resume');
		let resumeSessionId: number | null = null;
		let resumeSession: unknown | null = null;

		if (resumeParam) {
			resumeSessionId = parseInt(resumeParam);

			// Fetch the session to resume
			const sessionResponse = await fetch(`/api/saved-sessions?id=${resumeSessionId}`);
			if (sessionResponse.ok) {
				const sessionData = await sessionResponse.json();
				if (sessionData.success) {
					resumeSession = sessionData.session;
				}
			}
		}

		return {
			savedVectors: data.savedVectors || [],
			resumeSessionId,
			resumeSession
		};
	} catch (error) {
		console.error('Error loading match page data:', error);
		return { savedVectors: [], resumeSessionId: null, resumeSession: null };
	}
};
