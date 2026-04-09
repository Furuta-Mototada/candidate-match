import { db } from '$lib/server/db/index.js';
import { bill } from '$lib/server/db/schema.js';
import { eq, inArray } from 'drizzle-orm';

export type BillMetadataRow = {
	id: number;
	title: string | null;
	type: string | null;
	submissionSession: number | null;
	number: number | null;
};

/**
 * Fetch bill metadata (title, type, submissionSession, number) for a list of bill IDs.
 */
export async function getBillMetadata(billIds: number[]): Promise<BillMetadataRow[]> {
	if (billIds.length === 0) return [];
	return db
		.select({
			id: bill.id,
			title: bill.title,
			type: bill.type,
			submissionSession: bill.submissionSession,
			number: bill.number
		})
		.from(bill)
		.where(inArray(bill.id, billIds));
}

/**
 * Fetch the title of a single bill.
 */
export async function getBillTitle(billId: number): Promise<string | null> {
	const [row] = await db.select({ title: bill.title }).from(bill).where(eq(bill.id, billId));
	return row?.title ?? null;
}
