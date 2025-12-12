import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/index.js';
import {
	bill,
	billEnrichment,
	billDebates,
	billEmbeddings,
	billVotes,
	billVotesResultGroup,
	group
} from '$lib/server/db/schema.js';
import { eq, inArray, sql, desc } from 'drizzle-orm';

export interface KeyPoint {
	who: string;
	what: string;
	when: string;
}

export interface ProsAndCons {
	pros: string[];
	cons: string[];
}

export interface DebateRecord {
	id: number;
	speakerName: string;
	speakerGroup: string | null;
	speakerPosition: string | null;
	speechType: string | null;
	speechContent: string;
	speechUrl: string | null;
	meetingName: string;
	meetingDate: string | null;
	house: string;
}

export interface VoteResult {
	groupName: string;
	approved: boolean;
}

export interface EnrichedBillData {
	billId: number;
	title: string;
	description: string | null;
	passed: boolean;

	// LLM-generated content
	summaryShort: string | null;
	summaryDetailed: string | null;
	keyPoints: KeyPoint[];
	impactTags: string[];
	prosAndCons: ProsAndCons | null;
	exampleScenario: string | null;

	// Metadata
	enrichmentStatus: string;
	pdfUrl: string | null;

	// Debates (limited for display)
	debates: DebateRecord[];
	debateCount: number;

	// Vote results
	voteResults: VoteResult[];
}

/**
 * GET /api/bill-enrichment?billId=123
 *
 * Returns enriched bill data including LLM-generated summaries,
 * debate records, and voting results.
 */
export const GET: RequestHandler = async ({ url }): Promise<Response> => {
	try {
		const billIdParam = url.searchParams.get('billId');

		if (!billIdParam) {
			return json({ error: 'billId parameter is required' }, { status: 400 });
		}

		const billId = parseInt(billIdParam);
		if (isNaN(billId)) {
			return json({ error: 'Invalid billId' }, { status: 400 });
		}

		// Fetch bill basic info
		const [billData] = await db
			.select({
				id: bill.id,
				result: bill.result,
				title: bill.title,
				pdfUrl: billEmbeddings.pdfUrl
			})
			.from(bill)
			.leftJoin(billEmbeddings, eq(bill.id, billEmbeddings.billId))
			.where(eq(bill.id, billId));

		if (!billData) {
			return json({ error: 'Bill not found' }, { status: 404 });
		}

		// Fetch enrichment data
		const [enrichmentData] = await db
			.select()
			.from(billEnrichment)
			.where(eq(billEnrichment.billId, billId));

		// Parse JSON fields from enrichment
		let keyPoints: KeyPoint[] = [];
		let impactTags: string[] = [];
		let prosAndCons: ProsAndCons | null = null;

		if (enrichmentData) {
			try {
				if (enrichmentData.keyPoints) {
					keyPoints = JSON.parse(enrichmentData.keyPoints);
				}
				if (enrichmentData.impactTags) {
					impactTags = JSON.parse(enrichmentData.impactTags);
				}
				if (enrichmentData.prosAndCons) {
					prosAndCons = JSON.parse(enrichmentData.prosAndCons);
				}
			} catch (e) {
				console.error('Error parsing enrichment JSON:', e);
			}
		}

		// Fetch debate records (limited to 5 for display)
		const debates = await db
			.select({
				id: billDebates.id,
				speakerName: billDebates.speakerName,
				speakerGroup: billDebates.speakerGroup,
				speakerPosition: billDebates.speakerPosition,
				speechType: billDebates.speechType,
				speechContent: billDebates.speechContent,
				speechUrl: billDebates.speechUrl,
				meetingName: billDebates.meetingName,
				meetingDate: billDebates.meetingDate,
				house: billDebates.house
			})
			.from(billDebates)
			.where(eq(billDebates.billId, billId))
			.orderBy(desc(billDebates.meetingDate))
			.limit(5);

		// Get total debate count
		const [debateCountResult] = await db
			.select({ count: sql<number>`count(*)` })
			.from(billDebates)
			.where(eq(billDebates.billId, billId));

		// Fetch vote results by group
		const voteResults = await db
			.select({
				groupName: group.name,
				approved: billVotesResultGroup.approved
			})
			.from(billVotesResultGroup)
			.innerJoin(billVotes, eq(billVotesResultGroup.billVotesId, billVotes.id))
			.innerJoin(group, eq(billVotesResultGroup.groupId, group.id))
			.where(eq(billVotes.billId, billId));

		const result: EnrichedBillData = {
			billId: billData.id,
			title: billData.title || '',
			description: enrichmentData?.summaryShort || null,
			passed: billData.result === '可決',

			summaryShort: enrichmentData?.summaryShort || null,
			summaryDetailed: enrichmentData?.summaryDetailed || null,
			keyPoints,
			impactTags,
			prosAndCons,
			exampleScenario: enrichmentData?.exampleScenario || null,

			enrichmentStatus: enrichmentData?.status || 'pending',
			pdfUrl: billData.pdfUrl || null,

			debates: debates.map((d) => ({
				...d,
				meetingDate: d.meetingDate ? String(d.meetingDate) : null
			})),
			debateCount: debateCountResult?.count || 0,

			voteResults
		};

		return json(result);
	} catch (error) {
		console.error('Bill enrichment API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

/**
 * POST /api/bill-enrichment
 *
 * Batch fetch enrichment data for multiple bills
 * Body: { billIds: number[] }
 */
export const POST: RequestHandler = async ({ request }): Promise<Response> => {
	try {
		const { billIds } = await request.json();

		if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
			return json({ error: 'billIds array is required' }, { status: 400 });
		}

		// Limit batch size
		const limitedIds = billIds.slice(0, 50);

		// Fetch enrichment data for all bills
		const enrichments = await db
			.select({
				billId: billEnrichment.billId,
				summaryShort: billEnrichment.summaryShort,
				summaryDetailed: billEnrichment.summaryDetailed,
				keyPoints: billEnrichment.keyPoints,
				impactTags: billEnrichment.impactTags,
				prosAndCons: billEnrichment.prosAndCons,
				exampleScenario: billEnrichment.exampleScenario,
				status: billEnrichment.status
			})
			.from(billEnrichment)
			.where(inArray(billEnrichment.billId, limitedIds));

		// Create a map for quick lookup
		const enrichmentMap: Record<number, Partial<EnrichedBillData>> = {};

		for (const e of enrichments) {
			let keyPoints: KeyPoint[] = [];
			let impactTags: string[] = [];
			let prosAndCons: ProsAndCons | null = null;

			try {
				if (e.keyPoints) keyPoints = JSON.parse(e.keyPoints);
				if (e.impactTags) impactTags = JSON.parse(e.impactTags);
				if (e.prosAndCons) prosAndCons = JSON.parse(e.prosAndCons);
			} catch (err) {
				console.error('Error parsing enrichment JSON:', err);
			}

			enrichmentMap[e.billId] = {
				summaryShort: e.summaryShort,
				summaryDetailed: e.summaryDetailed,
				keyPoints,
				impactTags,
				prosAndCons,
				exampleScenario: e.exampleScenario,
				enrichmentStatus: e.status
			};
		}

		// For bills without enrichment, return pending status
		for (const id of limitedIds) {
			if (!enrichmentMap[id]) {
				enrichmentMap[id] = {
					enrichmentStatus: 'pending'
				};
			}
		}

		return json({ enrichments: enrichmentMap });
	} catch (error) {
		console.error('Bill enrichment batch API error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
