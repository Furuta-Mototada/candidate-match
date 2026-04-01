/**
 * Fix issues with member records created by scrape_shugiin.ts
 *
 * This script handles two types of issues:
 * 1. Duplicate members: Same person with different name variations (e.g. 髙木啓 vs 高木啓)
 * 2. Squished members: Two people accidentally merged into one record (e.g. 奥下剛光金村龍那)
 *
 * Members are looked up by name rather than hard-coded IDs.
 *
 * Usage:
 *   pnpm tsx scripts/fix_scrape_shugiin.ts
 */

import { eq, and, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import { createDbConnection } from './lib';
import * as schema from '../src/lib/server/db/schema';

// Duplicate name -> canonical name
const DUPLICATE_MAPPINGS: Array<{ duplicateName: string; canonicalName: string }> = [
	{ duplicateName: '髙木啓', canonicalName: '高木啓' }
];

// Squished name -> [target1 name, target2 name]
const SQUISHED_MAPPINGS: Array<{ squishedName: string; targetNames: [string, string] }> = [
	{ squishedName: '奥下剛光金村龍那', targetNames: ['奥下剛光', '金村龍那'] },
	{ squishedName: '渡辺創石井智恵', targetNames: ['渡辺創', '石井智恵'] }
];

function findMemberByName(
	allMembers: Array<{ id: number; names: string[] }>,
	name: string
): { id: number; names: string[] } | null {
	return allMembers.find((m) => m.names.includes(name)) ?? null;
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;

	if (!DATABASE_URL) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}

	const { client, db } = createDbConnection(DATABASE_URL);

	try {
		// Load all members once for name lookups
		const allMembers = await db.select().from(schema.member);

		// ========================================
		// PART 1: Fix duplicate members
		// ========================================
		console.log('=== Processing Duplicate Members ===');

		for (const { duplicateName, canonicalName } of DUPLICATE_MAPPINGS) {
			const dupMember = findMemberByName(allMembers, duplicateName);
			const canMember = findMemberByName(allMembers, canonicalName);

			if (dupMember && canMember && dupMember.id === canMember.id) {
				console.log(
					`"${duplicateName}" and "${canonicalName}" are already the same member. Skipping.`
				);
				continue;
			}
			if (!dupMember) {
				console.log(`"${duplicateName}" not found — already merged. Skipping.`);
				continue;
			}
			if (!canMember) {
				console.error(`Canonical "${canonicalName}" not found!`);
				continue;
			}

			const dupId = dupMember.id;
			const canId = canMember.id;
			console.log(`\nMerging "${duplicateName}" (${dupId}) into "${canonicalName}" (${canId})`);

			// Migrate bill_supporters
			const supporters = await db
				.select()
				.from(schema.billSupporters)
				.where(eq(schema.billSupporters.memberId, dupId));

			if (supporters.length > 0) {
				const billIds = supporters.map((s) => s.billId);
				const existing = await db
					.select()
					.from(schema.billSupporters)
					.where(
						and(
							eq(schema.billSupporters.memberId, canId),
							inArray(schema.billSupporters.billId, billIds)
						)
					);
				const existingBillIds = new Set(existing.map((s) => s.billId));

				for (const s of supporters) {
					if (existingBillIds.has(s.billId)) {
						await db
							.delete(schema.billSupporters)
							.where(
								and(
									eq(schema.billSupporters.billId, s.billId),
									eq(schema.billSupporters.memberId, dupId)
								)
							);
					} else {
						await db
							.update(schema.billSupporters)
							.set({ memberId: canId })
							.where(
								and(
									eq(schema.billSupporters.billId, s.billId),
									eq(schema.billSupporters.memberId, dupId)
								)
							);
					}
				}
				console.log(`  Migrated ${supporters.length} bill_supporters`);
			}

			// Migrate bill_sponsors
			const sponsors = await db
				.select()
				.from(schema.billSponsors)
				.where(eq(schema.billSponsors.memberId, dupId));

			if (sponsors.length > 0) {
				const billIds = sponsors.map((s) => s.billId);
				const existing = await db
					.select()
					.from(schema.billSponsors)
					.where(
						and(
							eq(schema.billSponsors.memberId, canId),
							inArray(schema.billSponsors.billId, billIds)
						)
					);
				const existingBillIds = new Set(existing.map((s) => s.billId));

				for (const s of sponsors) {
					if (existingBillIds.has(s.billId)) {
						await db
							.delete(schema.billSponsors)
							.where(
								and(
									eq(schema.billSponsors.billId, s.billId),
									eq(schema.billSponsors.memberId, dupId)
								)
							);
					} else {
						await db
							.update(schema.billSponsors)
							.set({ memberId: canId })
							.where(
								and(
									eq(schema.billSponsors.billId, s.billId),
									eq(schema.billSponsors.memberId, dupId)
								)
							);
					}
				}
				console.log(`  Migrated ${sponsors.length} bill_sponsors`);
			}

			// Migrate bill_votes_result_member
			const voteResults = await db
				.select()
				.from(schema.billVotesResultMember)
				.where(eq(schema.billVotesResultMember.memberId, dupId));

			if (voteResults.length > 0) {
				const voteIds = voteResults.map((v) => v.billVotesId);
				const existing = await db
					.select()
					.from(schema.billVotesResultMember)
					.where(
						and(
							eq(schema.billVotesResultMember.memberId, canId),
							inArray(schema.billVotesResultMember.billVotesId, voteIds)
						)
					);
				const existingVoteIds = new Set(existing.map((v) => v.billVotesId));

				for (const v of voteResults) {
					if (existingVoteIds.has(v.billVotesId)) {
						await db
							.delete(schema.billVotesResultMember)
							.where(
								and(
									eq(schema.billVotesResultMember.billVotesId, v.billVotesId),
									eq(schema.billVotesResultMember.memberId, dupId)
								)
							);
					} else {
						await db
							.update(schema.billVotesResultMember)
							.set({ memberId: canId })
							.where(
								and(
									eq(schema.billVotesResultMember.billVotesId, v.billVotesId),
									eq(schema.billVotesResultMember.memberId, dupId)
								)
							);
					}
				}
				console.log(`  Migrated ${voteResults.length} bill_votes_result_member`);
			}

			// Update canonical member names and delete duplicate
			const allNames = Array.from(new Set([...canMember.names, ...dupMember.names]));
			await db.update(schema.member).set({ names: allNames }).where(eq(schema.member.id, canId));
			await db.delete(schema.member).where(eq(schema.member.id, dupId));
			console.log(`  Updated names: ${JSON.stringify(allNames)}, deleted member ${dupId}`);
		}

		// ========================================
		// PART 2: Fix squished members
		// ========================================
		console.log('\n=== Processing Squished Members ===');

		for (const { squishedName, targetNames } of SQUISHED_MAPPINGS) {
			const squishedMember = findMemberByName(allMembers, squishedName);
			if (!squishedMember) {
				console.log(`"${squishedName}" not found — already fixed. Skipping.`);
				continue;
			}

			const target1 = findMemberByName(allMembers, targetNames[0]);
			const target2 = findMemberByName(allMembers, targetNames[1]);
			if (!target1 || !target2) {
				console.error(`Target members not found for "${squishedName}": ${targetNames.join(', ')}`);
				continue;
			}

			console.log(
				`\nSplitting "${squishedName}" (${squishedMember.id}) into "${targetNames[0]}" (${target1.id}) + "${targetNames[1]}" (${target2.id})`
			);

			// Split bill_supporters to both targets
			const supporters = await db
				.select()
				.from(schema.billSupporters)
				.where(eq(schema.billSupporters.memberId, squishedMember.id));

			if (supporters.length > 0) {
				for (const target of [target1, target2]) {
					const billIds = supporters.map((s) => s.billId);
					const existing = await db
						.select()
						.from(schema.billSupporters)
						.where(
							and(
								eq(schema.billSupporters.memberId, target.id),
								inArray(schema.billSupporters.billId, billIds)
							)
						);
					const existingBillIds = new Set(existing.map((s) => s.billId));
					const toInsert = supporters.filter((s) => !existingBillIds.has(s.billId));

					for (const s of toInsert) {
						await db.insert(schema.billSupporters).values({
							billId: s.billId,
							memberId: target.id
						});
					}
					console.log(`  Inserted ${toInsert.length} bill_supporters for ${target.names[0]}`);
				}

				// Delete squished supporters
				for (const s of supporters) {
					await db
						.delete(schema.billSupporters)
						.where(
							and(
								eq(schema.billSupporters.billId, s.billId),
								eq(schema.billSupporters.memberId, squishedMember.id)
							)
						);
				}
			}

			// Split bill_sponsors to both targets
			const sponsors = await db
				.select()
				.from(schema.billSponsors)
				.where(eq(schema.billSponsors.memberId, squishedMember.id));

			if (sponsors.length > 0) {
				for (const target of [target1, target2]) {
					const billIds = sponsors.map((s) => s.billId);
					const existing = await db
						.select()
						.from(schema.billSponsors)
						.where(
							and(
								eq(schema.billSponsors.memberId, target.id),
								inArray(schema.billSponsors.billId, billIds)
							)
						);
					const existingBillIds = new Set(existing.map((s) => s.billId));
					const toInsert = sponsors.filter((s) => !existingBillIds.has(s.billId));

					for (const s of toInsert) {
						await db.insert(schema.billSponsors).values({
							billId: s.billId,
							memberId: target.id
						});
					}
					console.log(`  Inserted ${toInsert.length} bill_sponsors for ${target.names[0]}`);
				}

				// Delete squished sponsors
				for (const s of sponsors) {
					await db
						.delete(schema.billSponsors)
						.where(
							and(
								eq(schema.billSponsors.billId, s.billId),
								eq(schema.billSponsors.memberId, squishedMember.id)
							)
						);
				}
			}

			// Delete squished member
			await db.delete(schema.member).where(eq(schema.member.id, squishedMember.id));
			console.log(`  Deleted squished member ${squishedMember.id}`);
		}

		console.log('\n=== Fix Complete ===');
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
