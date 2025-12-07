import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import { bill, member, billVotesResultMember } from '$lib/server/db/schema.js';
import { count, countDistinct } from 'drizzle-orm';

/**
 * GET /api/stats
 * Get overall statistics for the platform
 */
export const GET: RequestHandler = async () => {
	try {
		// Get total bills
		const [billCount] = await db.select({ count: count() }).from(bill);

		// Get total members
		const [memberCount] = await db.select({ count: count() }).from(member);

		// Get total individual votes (from billVotesResultMember)
		const [voteCount] = await db.select({ count: count() }).from(billVotesResultMember);

		// Get number of unique sessions analyzed
		const [sessionCount] = await db
			.select({ count: countDistinct(bill.submissionSession) })
			.from(bill);

		return json({
			totalBills: billCount.count,
			totalMembers: memberCount.count,
			totalVotes: voteCount.count,
			sessionsAnalyzed: sessionCount.count
		});
	} catch (error) {
		console.error('Error fetching stats:', error);
		return json(
			{
				error: 'Failed to fetch statistics'
			},
			{ status: 500 }
		);
	}
};
