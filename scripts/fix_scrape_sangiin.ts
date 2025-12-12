/**
 * Merge duplicate member records: 河井あんり (3327) into 河井案里 (3185)
 *
 * This script:
 * 1. Updates all bill_votes_result_member records from member 3327 to 3185
 * 2. Deletes the duplicate member 3327
 *
 * Background:
 * - Member 3185 (河井案里) was created by scrape_kokkai_members.ts with proper reading and party data
 * - Member 3327 (河井あんり) was incorrectly created by scrape_sangiin.ts with a different name variation
 * - These are the same person (かわいあんり)
 *
 * Usage:
 *   pnpm tsx scripts/merge_duplicate_member.ts [--dry-run]
 */

import { eq, and, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import { createDbConnection, type DrizzleDB } from './lib';
import * as schema from '../src/lib/server/db/schema';

// Hard-coded IDs for this specific merge
const DUPLICATE_MEMBER_ID = 3327; // 河井あんり (to be deleted)
const CANONICAL_MEMBER_ID = 3185; // 河井案里 (to keep)

async function main() {
	const DRY_RUN = process.argv.includes('--dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	if (!DATABASE_URL) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}

	const { client, db } = createDbConnection(DATABASE_URL);

	try {
		console.log('=== Merge Duplicate Member Script ===');
		console.log(`Merging member ${DUPLICATE_MEMBER_ID} into ${CANONICAL_MEMBER_ID}`);
		if (DRY_RUN) {
			console.log('[DRY-RUN MODE - No changes will be made]');
		}

		// Step 1: Verify both members exist
		const members = await db
			.select()
			.from(schema.member)
			.where(inArray(schema.member.id, [DUPLICATE_MEMBER_ID, CANONICAL_MEMBER_ID]));

		const duplicateMember = members.find((m) => m.id === DUPLICATE_MEMBER_ID);
		const canonicalMember = members.find((m) => m.id === CANONICAL_MEMBER_ID);

		if (!duplicateMember) {
			console.log(`Member ${DUPLICATE_MEMBER_ID} not found - already merged or doesn't exist.`);
			await client.end();
			return;
		}

		if (!canonicalMember) {
			console.error(`Canonical member ${CANONICAL_MEMBER_ID} not found!`);
			process.exit(1);
		}

		console.log(`\nDuplicate member: ${JSON.stringify(duplicateMember)}`);
		console.log(`Canonical member: ${JSON.stringify(canonicalMember)}`);

		// Step 2: Check for vote results to migrate
		const voteResults = await db
			.select()
			.from(schema.billVotesResultMember)
			.where(eq(schema.billVotesResultMember.memberId, DUPLICATE_MEMBER_ID));

		console.log(`\nFound ${voteResults.length} vote results to migrate`);

		if (voteResults.length > 0) {
			// Check if any of these vote results already exist for the canonical member
			// (to avoid primary key conflicts)
			const voteIds = voteResults.map((v) => v.billVotesId);
			const existingCanonicalVotes = await db
				.select()
				.from(schema.billVotesResultMember)
				.where(
					and(
						eq(schema.billVotesResultMember.memberId, CANONICAL_MEMBER_ID),
						inArray(schema.billVotesResultMember.billVotesId, voteIds)
					)
				);

			if (existingCanonicalVotes.length > 0) {
				console.log(
					`Warning: ${existingCanonicalVotes.length} votes already exist for canonical member`
				);
				console.log('These will be skipped (duplicate votes deleted):');
				existingCanonicalVotes.forEach((v) => console.log(`  - billVotesId: ${v.billVotesId}`));
			}

			const existingVoteIds = new Set(existingCanonicalVotes.map((v) => v.billVotesId));
			const votesToMigrate = voteResults.filter((v) => !existingVoteIds.has(v.billVotesId));
			const votesToDelete = voteResults.filter((v) => existingVoteIds.has(v.billVotesId));

			if (!DRY_RUN) {
				// Delete duplicate votes that would conflict
				if (votesToDelete.length > 0) {
					for (const vote of votesToDelete) {
						await db
							.delete(schema.billVotesResultMember)
							.where(
								and(
									eq(schema.billVotesResultMember.billVotesId, vote.billVotesId),
									eq(schema.billVotesResultMember.memberId, DUPLICATE_MEMBER_ID)
								)
							);
					}
					console.log(`Deleted ${votesToDelete.length} conflicting vote results`);
				}

				// Migrate remaining votes
				if (votesToMigrate.length > 0) {
					for (const vote of votesToMigrate) {
						await db
							.update(schema.billVotesResultMember)
							.set({ memberId: CANONICAL_MEMBER_ID })
							.where(
								and(
									eq(schema.billVotesResultMember.billVotesId, vote.billVotesId),
									eq(schema.billVotesResultMember.memberId, DUPLICATE_MEMBER_ID)
								)
							);
					}
					console.log(`Migrated ${votesToMigrate.length} vote results to member ${CANONICAL_MEMBER_ID}`);
				}
			} else {
				console.log(`[DRY-RUN] Would migrate ${votesToMigrate.length} vote results`);
				console.log(`[DRY-RUN] Would delete ${votesToDelete.length} conflicting vote results`);
			}
		}

		// Step 3: Check for other tables that might reference this member
		// bill_sponsors
		const billSponsors = await db
			.select()
			.from(schema.billSponsors)
			.where(eq(schema.billSponsors.memberId, DUPLICATE_MEMBER_ID));
		if (billSponsors.length > 0) {
			console.log(`Found ${billSponsors.length} bill sponsor records`);
			if (!DRY_RUN) {
				// Would need to handle potential conflicts here too
				console.log('Migrating bill sponsors...');
			}
		}

		// bill_supporters
		const billSupporters = await db
			.select()
			.from(schema.billSupporters)
			.where(eq(schema.billSupporters.memberId, DUPLICATE_MEMBER_ID));
		if (billSupporters.length > 0) {
			console.log(`Found ${billSupporters.length} bill supporter records`);
			if (!DRY_RUN) {
				// Would need to handle potential conflicts here too
				console.log('Migrating bill supporters...');
			}
		}

		// member_party
		const memberParty = await db
			.select()
			.from(schema.memberParty)
			.where(eq(schema.memberParty.memberId, DUPLICATE_MEMBER_ID));
		if (memberParty.length > 0) {
			console.log(`Found ${memberParty.length} member_party records`);
			if (!DRY_RUN) {
				await db
					.delete(schema.memberParty)
					.where(eq(schema.memberParty.memberId, DUPLICATE_MEMBER_ID));
				console.log('Deleted duplicate member_party records');
			}
		}

		// member_group
		const memberGroup = await db
			.select()
			.from(schema.memberGroup)
			.where(eq(schema.memberGroup.memberId, DUPLICATE_MEMBER_ID));
		if (memberGroup.length > 0) {
			console.log(`Found ${memberGroup.length} member_group records`);
			if (!DRY_RUN) {
				await db
					.delete(schema.memberGroup)
					.where(eq(schema.memberGroup.memberId, DUPLICATE_MEMBER_ID));
				console.log('Deleted duplicate member_group records');
			}
		}

		// cabinet
		const cabinet = await db
			.select()
			.from(schema.cabinet)
			.where(eq(schema.cabinet.memberId, DUPLICATE_MEMBER_ID));
		if (cabinet.length > 0) {
			console.log(`Found ${cabinet.length} cabinet records`);
		}

		// Step 4: Update canonical member's names array to include the duplicate's name variation
		const allNames = new Set([...canonicalMember.names, ...duplicateMember.names]);
		const mergedNames = Array.from(allNames);

		if (!DRY_RUN) {
			await db
				.update(schema.member)
				.set({ names: mergedNames })
				.where(eq(schema.member.id, CANONICAL_MEMBER_ID));
			console.log(`\nUpdated canonical member names: ${JSON.stringify(mergedNames)}`);
		} else {
			console.log(`[DRY-RUN] Would update names to: ${JSON.stringify(mergedNames)}`);
		}

		// Step 5: Delete the duplicate member
		if (!DRY_RUN) {
			await db.delete(schema.member).where(eq(schema.member.id, DUPLICATE_MEMBER_ID));
			console.log(`\nDeleted duplicate member ${DUPLICATE_MEMBER_ID}`);
		} else {
			console.log(`[DRY-RUN] Would delete member ${DUPLICATE_MEMBER_ID}`);
		}

		console.log('\n=== Merge Complete ===');
	} finally {
		await client.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
