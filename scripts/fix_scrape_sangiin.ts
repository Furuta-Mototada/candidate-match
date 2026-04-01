/**
 * Fix known duplicate members created by scrape_sangiin.ts
 *
 * Merges duplicate member records where sangiin.go.jp vote pages use a different
 * name form than scrape_kokkai_members.ts. Looks up members by name rather than
 * hard-coded IDs.
 *
 * Known cases:
 * - 河井あんり (vote page) → 河井案里 (kokkai) — same person (かわいあんり)
 *
 * Usage:
 *   pnpm tsx scripts/fix_scrape_sangiin.ts
 */

import { eq, and, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import { createDbConnection, type DrizzleDB } from './lib';
import * as schema from '../src/lib/server/db/schema';

// Hard-coded duplicate → canonical name pairs
const DUPLICATE_MERGES: Array<{ duplicateName: string; canonicalName: string }> = [
	{ duplicateName: '河井あんり', canonicalName: '河井案里' }
];

async function findMemberByName(
	db: DrizzleDB,
	name: string
): Promise<{ id: number; names: string[] } | null> {
	const all = await db.select().from(schema.member);
	const found = all.find((m) => m.names.includes(name));
	return found ? { id: found.id, names: found.names } : null;
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;

	if (!DATABASE_URL) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}

	const { client, db } = createDbConnection(DATABASE_URL);

	try {
		console.log('=== Fix scrape_sangiin duplicates ===');

		for (const { duplicateName, canonicalName } of DUPLICATE_MERGES) {
			const duplicateMember = await findMemberByName(db, duplicateName);
			const canonicalMember = await findMemberByName(db, canonicalName);

			// Skip if they resolved to the same member (already merged)
			if (duplicateMember && canonicalMember && duplicateMember.id === canonicalMember.id) {
				console.log(
					`"${duplicateName}" and "${canonicalName}" are already the same member (${canonicalMember.id}). Skipping.`
				);
				continue;
			}

			if (!duplicateMember) {
				console.log(`"${duplicateName}" not found — already merged or doesn't exist. Skipping.`);
				continue;
			}

			if (!canonicalMember) {
				console.error(`Canonical member "${canonicalName}" not found!`);
				continue;
			}

			const DUPLICATE_ID = duplicateMember.id;
			const CANONICAL_ID = canonicalMember.id;
			console.log(
				`\nMerging "${duplicateName}" (${DUPLICATE_ID}) into "${canonicalName}" (${CANONICAL_ID})`
			);

			// Migrate bill_votes_result_member
			const voteResults = await db
				.select()
				.from(schema.billVotesResultMember)
				.where(eq(schema.billVotesResultMember.memberId, DUPLICATE_ID));

			console.log(`Found ${voteResults.length} vote results to migrate`);

			if (voteResults.length > 0) {
				const voteIds = voteResults.map((v) => v.billVotesId);
				const existingCanonicalVotes = await db
					.select()
					.from(schema.billVotesResultMember)
					.where(
						and(
							eq(schema.billVotesResultMember.memberId, CANONICAL_ID),
							inArray(schema.billVotesResultMember.billVotesId, voteIds)
						)
					);

				const existingVoteIds = new Set(existingCanonicalVotes.map((v) => v.billVotesId));
				const votesToMigrate = voteResults.filter((v) => !existingVoteIds.has(v.billVotesId));
				const votesToDelete = voteResults.filter((v) => existingVoteIds.has(v.billVotesId));

				// Delete conflicting votes
				for (const vote of votesToDelete) {
					await db
						.delete(schema.billVotesResultMember)
						.where(
							and(
								eq(schema.billVotesResultMember.billVotesId, vote.billVotesId),
								eq(schema.billVotesResultMember.memberId, DUPLICATE_ID)
							)
						);
				}
				if (votesToDelete.length > 0) {
					console.log(`Deleted ${votesToDelete.length} conflicting vote results`);
				}

				// Migrate remaining votes
				for (const vote of votesToMigrate) {
					await db
						.update(schema.billVotesResultMember)
						.set({ memberId: CANONICAL_ID })
						.where(
							and(
								eq(schema.billVotesResultMember.billVotesId, vote.billVotesId),
								eq(schema.billVotesResultMember.memberId, DUPLICATE_ID)
							)
						);
				}
				if (votesToMigrate.length > 0) {
					console.log(`Migrated ${votesToMigrate.length} vote results`);
				}
			}

			// Clean up related tables
			await db.delete(schema.memberParty).where(eq(schema.memberParty.memberId, DUPLICATE_ID));
			await db.delete(schema.memberGroup).where(eq(schema.memberGroup.memberId, DUPLICATE_ID));

			// Update canonical member's names to include duplicate's name variant
			const allNames = Array.from(new Set([...canonicalMember.names, ...duplicateMember.names]));
			await db
				.update(schema.member)
				.set({ names: allNames })
				.where(eq(schema.member.id, CANONICAL_ID));
			console.log(`Updated canonical member names: ${JSON.stringify(allNames)}`);

			// Delete duplicate member
			await db.delete(schema.member).where(eq(schema.member.id, DUPLICATE_ID));
			console.log(`Deleted duplicate member ${DUPLICATE_ID}`);
		}

		console.log('\n=== Fix complete ===');
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
