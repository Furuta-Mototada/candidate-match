import type { PageServerLoad } from './$types.js';
import legislationScoresData from '$lib/data/legislation_scores.json';

export const load: PageServerLoad = async () => {
	return {
		legislationScores: legislationScoresData
	};
};
