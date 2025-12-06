import type { PageServerLoad } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const load: PageServerLoad = async () => {
	try {
		// Read the legislation scores JSON file
		const filePath = join(process.cwd(), 'src', 'lib', 'data', 'legislation_scores.json');
		const fileContent = await readFile(filePath, 'utf-8');
		const legislationScores = JSON.parse(fileContent);

		return {
			legislationScores
		};
	} catch (error) {
		console.error('Error loading legislation scores:', error);
		return {
			legislationScores: []
		};
	}
};
