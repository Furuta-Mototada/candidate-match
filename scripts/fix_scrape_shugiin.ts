/**
 * Fix issues with member records created by scrape_shugiin.ts
 *
 * This script handles two types of issues:
 * 1. Duplicate members: Same person with different name variations
 * 2. Squished members: Two people accidentally merged into one record
 *
 * For duplicates:
 * - Updates all bill_supporters/bill_sponsors records from duplicate to canonical
 * - Merges name variations into the canonical member's names array
 * - Deletes the duplicate member records
 *
 * For squished members:
 * - Duplicates bill_supporters/bill_sponsors records to both target members
 * - Deletes the squished member record
 *
 * Background:
 * - Canonical members were created by scrape_kokkai_members.ts with proper reading and party data
 * - Duplicate/squished members were incorrectly created by scrape_shugiin.ts
 *
 * Usage:
 *   pnpm tsx scripts/fix_scrape_shugiin.ts [--dry-run]
 */

import { eq, and, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import { createDbConnection } from './lib';
import * as schema from '../src/lib/server/db/schema';

// Hard-coded mappings: duplicate ID -> canonical ID
const DUPLICATE_MAPPINGS: Array<{ duplicate: number; canonical: number }> = [
	{ duplicate: 3329, canonical: 2836 }, // 安藤じゅん子 -> 安藤淳子
	{ duplicate: 3342, canonical: 2465 }, // 髙木啓 -> 高木啓
	{ duplicate: 3341, canonical: 2915 }, // 堀川あきこ -> 堀川朗子
	{ duplicate: 3340, canonical: 2722 }, // うるま譲司 -> 漆間譲司
	{ duplicate: 3339, canonical: 2926 }, // 森ようすけ -> 森洋介
	{ duplicate: 3338, canonical: 2919 }, // 眞野哲 -> 真野哲
	{ duplicate: 3337, canonical: 2914 }, // 藤原規眞 -> 藤原規真
	{ duplicate: 3336, canonical: 2798 }, // 藤岡たかお -> 藤岡隆雄
	{ duplicate: 3335, canonical: 2889 }, // 長友よしひろ -> 長友克洋
	{ duplicate: 3334, canonical: 2867 }, // 佐々木ナオミ -> 佐々木奈保美
	{ duplicate: 3333, canonical: 2864 }, // 齋藤裕喜 -> 斎藤裕喜
	{ duplicate: 3332, canonical: 2845 }, // おおたけりえ -> 大嶽理恵
	{ duplicate: 3331, canonical: 2839 }, // 市來伴子 -> 市来伴子
	{ duplicate: 3330, canonical: 2837 } // 五十嵐えり -> 五十嵐衣里
];

// Hard-coded mappings: squished ID -> [target1, target2] (two people merged into one)
const SQUISHED_MAPPINGS: Array<{ squished: number; targets: [number, number] }> = [
	{ squished: 3328, targets: [2728, 2735] }, // 奥下剛光金村龍那 -> 奥下剛光 + 金村龍那
	{ squished: 3343, targets: [2830, 2838] } // 渡辺創石井智恵 -> 渡辺創 + 石井智恵
];

// Members that were missed by scrape_kokkai_members.ts and need party info added
const MISSING_MEMBER_PARTY: Array<{
	memberId: number;
	nameReading: string;
	partyId: number;
	startDate: string;
	endDate: string | null;
	chamber: '衆議院' | '参議院';
}> = [
	{
		memberId: 3344,
		nameReading: 'はらだまさひろ',
		partyId: 45,
		startDate: '2024-10-27',
		endDate: null,
		chamber: '衆議院'
	}, // 原田和広
	{
		memberId: 3345,
		nameReading: 'まるおけいすけ',
		partyId: 45,
		startDate: '2024-10-27',
		endDate: null,
		chamber: '衆議院'
	} // 丸尾圭祐
];

async function main() {
	const DRY_RUN = process.argv.includes('--dry-run');
	const DATABASE_URL = process.env.DATABASE_URL;

	if (!DATABASE_URL) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}

	const { client, db } = createDbConnection(DATABASE_URL);

	try {
		console.log('=== Fix Shugiin Duplicate Members Script ===');
		console.log(`Processing ${DUPLICATE_MAPPINGS.length} duplicate member mappings`);
		if (DRY_RUN) {
			console.log('[DRY-RUN MODE - No changes will be made]');
		}

		const allIds = DUPLICATE_MAPPINGS.flatMap((m) => [m.duplicate, m.canonical]);
		const duplicateIds = DUPLICATE_MAPPINGS.map((m) => m.duplicate);

		// Step 1: Verify all members exist
		const members = await db.select().from(schema.member).where(inArray(schema.member.id, allIds));

		const memberMap = new Map(members.map((m) => [m.id, m]));

		// Check for any missing members
		const missingDuplicates = DUPLICATE_MAPPINGS.filter((m) => !memberMap.has(m.duplicate));
		if (missingDuplicates.length > 0) {
			console.log(
				`\nNote: ${missingDuplicates.length} duplicate members not found (already merged?):`
			);
			missingDuplicates.forEach((m) => console.log(`  - ${m.duplicate}`));
		}

		const missingCanonicals = DUPLICATE_MAPPINGS.filter((m) => !memberMap.has(m.canonical));
		if (missingCanonicals.length > 0) {
			console.error(`\nError: ${missingCanonicals.length} canonical members not found!`);
			missingCanonicals.forEach((m) => console.log(`  - ${m.canonical}`));
			process.exit(1);
		}

		// Filter to only mappings where both members exist
		const validMappings = DUPLICATE_MAPPINGS.filter(
			(m) => memberMap.has(m.duplicate) && memberMap.has(m.canonical)
		);
		console.log(`\nProcessing ${validMappings.length} valid mappings`);

		if (validMappings.length === 0) {
			console.log('No duplicate members to process.');
		}

		if (validMappings.length > 0) {
			// Step 2: Get all bill_supporters records for duplicate members
			const supporters = await db
				.select()
				.from(schema.billSupporters)
				.where(inArray(schema.billSupporters.memberId, duplicateIds));

			console.log(`\nFound ${supporters.length} bill_supporters records to migrate`);

			// Group by member for reporting
			const supportersByMember = new Map<number, typeof supporters>();
			for (const s of supporters) {
				if (!supportersByMember.has(s.memberId)) {
					supportersByMember.set(s.memberId, []);
				}
				supportersByMember.get(s.memberId)!.push(s);
			}

			// Step 3: Migrate bill_supporters
			for (const { duplicate, canonical } of validMappings) {
				const memberSupporters = supportersByMember.get(duplicate) || [];
				if (memberSupporters.length === 0) continue;

				console.log(
					`\nMigrating ${memberSupporters.length} supporters from ${duplicate} to ${canonical}`
				);

				// Check for existing canonical supporters (to avoid primary key conflicts)
				const billIds = memberSupporters.map((s) => s.billId);
				const existingCanonical = await db
					.select()
					.from(schema.billSupporters)
					.where(
						and(
							eq(schema.billSupporters.memberId, canonical),
							inArray(schema.billSupporters.billId, billIds)
						)
					);

				const existingBillIds = new Set(existingCanonical.map((s) => s.billId));
				const toMigrate = memberSupporters.filter((s) => !existingBillIds.has(s.billId));
				const toDelete = memberSupporters.filter((s) => existingBillIds.has(s.billId));

				if (existingBillIds.size > 0) {
					console.log(
						`  - ${existingBillIds.size} already exist for canonical (will delete duplicates)`
					);
				}

				if (!DRY_RUN) {
					// Delete conflicting records
					for (const s of toDelete) {
						await db
							.delete(schema.billSupporters)
							.where(
								and(
									eq(schema.billSupporters.billId, s.billId),
									eq(schema.billSupporters.memberId, duplicate)
								)
							);
					}

					// Migrate remaining records
					for (const s of toMigrate) {
						await db
							.update(schema.billSupporters)
							.set({ memberId: canonical })
							.where(
								and(
									eq(schema.billSupporters.billId, s.billId),
									eq(schema.billSupporters.memberId, duplicate)
								)
							);
					}
					console.log(`  - Migrated ${toMigrate.length}, deleted ${toDelete.length} conflicts`);
				} else {
					console.log(
						`  [DRY-RUN] Would migrate ${toMigrate.length}, delete ${toDelete.length} conflicts`
					);
				}
			}

			// Step 4: Get and migrate bill_sponsors records
			const sponsors = await db
				.select()
				.from(schema.billSponsors)
				.where(inArray(schema.billSponsors.memberId, duplicateIds));

			console.log(`\nFound ${sponsors.length} bill_sponsors records to migrate`);

			if (sponsors.length > 0) {
				// Group by member for reporting
				const sponsorsByMember = new Map<number, typeof sponsors>();
				for (const s of sponsors) {
					if (!sponsorsByMember.has(s.memberId)) {
						sponsorsByMember.set(s.memberId, []);
					}
					sponsorsByMember.get(s.memberId)!.push(s);
				}

				for (const { duplicate, canonical } of validMappings) {
					const memberSponsors = sponsorsByMember.get(duplicate) || [];
					if (memberSponsors.length === 0) continue;

					console.log(
						`Migrating ${memberSponsors.length} sponsors from ${duplicate} to ${canonical}`
					);

					// Check for existing canonical sponsors (to avoid primary key conflicts)
					const billIds = memberSponsors.map((s) => s.billId);
					const existingCanonical = await db
						.select()
						.from(schema.billSponsors)
						.where(
							and(
								eq(schema.billSponsors.memberId, canonical),
								inArray(schema.billSponsors.billId, billIds)
							)
						);

					const existingBillIds = new Set(existingCanonical.map((s) => s.billId));
					const toMigrate = memberSponsors.filter((s) => !existingBillIds.has(s.billId));
					const toDelete = memberSponsors.filter((s) => existingBillIds.has(s.billId));

					if (existingBillIds.size > 0) {
						console.log(
							`  - ${existingBillIds.size} already exist for canonical (will delete duplicates)`
						);
					}

					if (!DRY_RUN) {
						// Delete conflicting records
						for (const s of toDelete) {
							await db
								.delete(schema.billSponsors)
								.where(
									and(
										eq(schema.billSponsors.billId, s.billId),
										eq(schema.billSponsors.memberId, duplicate)
									)
								);
						}

						// Migrate remaining records
						for (const s of toMigrate) {
							await db
								.update(schema.billSponsors)
								.set({ memberId: canonical })
								.where(
									and(
										eq(schema.billSponsors.billId, s.billId),
										eq(schema.billSponsors.memberId, duplicate)
									)
								);
						}
						console.log(`  - Migrated ${toMigrate.length}, deleted ${toDelete.length} conflicts`);
					} else {
						console.log(
							`  [DRY-RUN] Would migrate ${toMigrate.length}, delete ${toDelete.length} conflicts`
						);
					}
				}
			}

			// Step 5: Get and migrate bill_votes_result_member records
			const voteResults = await db
				.select()
				.from(schema.billVotesResultMember)
				.where(inArray(schema.billVotesResultMember.memberId, duplicateIds));

			if (voteResults.length > 0) {
				console.log(`\nFound ${voteResults.length} bill_votes_result_member records to migrate`);

				for (const { duplicate, canonical } of validMappings) {
					const memberVotes = voteResults.filter((v) => v.memberId === duplicate);
					if (memberVotes.length === 0) continue;

					console.log(`Migrating ${memberVotes.length} votes from ${duplicate} to ${canonical}`);

					// Check for existing canonical votes
					const voteIds = memberVotes.map((v) => v.billVotesId);
					const existingCanonical = await db
						.select()
						.from(schema.billVotesResultMember)
						.where(
							and(
								eq(schema.billVotesResultMember.memberId, canonical),
								inArray(schema.billVotesResultMember.billVotesId, voteIds)
							)
						);

					const existingVoteIds = new Set(existingCanonical.map((v) => v.billVotesId));
					const toMigrate = memberVotes.filter((v) => !existingVoteIds.has(v.billVotesId));
					const toDelete = memberVotes.filter((v) => existingVoteIds.has(v.billVotesId));

					if (!DRY_RUN) {
						// Delete conflicting records
						for (const v of toDelete) {
							await db
								.delete(schema.billVotesResultMember)
								.where(
									and(
										eq(schema.billVotesResultMember.billVotesId, v.billVotesId),
										eq(schema.billVotesResultMember.memberId, duplicate)
									)
								);
						}

						// Migrate remaining records
						for (const v of toMigrate) {
							await db
								.update(schema.billVotesResultMember)
								.set({ memberId: canonical })
								.where(
									and(
										eq(schema.billVotesResultMember.billVotesId, v.billVotesId),
										eq(schema.billVotesResultMember.memberId, duplicate)
									)
								);
						}
						console.log(`  - Migrated ${toMigrate.length}, deleted ${toDelete.length} conflicts`);
					} else {
						console.log(
							`  [DRY-RUN] Would migrate ${toMigrate.length}, delete ${toDelete.length} conflicts`
						);
					}
				}
			}

			// Step 6: Update canonical member names arrays
			console.log('\nUpdating member names arrays...');
			for (const { duplicate, canonical } of validMappings) {
				const dupMember = memberMap.get(duplicate);
				const canMember = memberMap.get(canonical);
				if (!dupMember || !canMember) continue;

				const allNames = new Set([...canMember.names, ...dupMember.names]);
				const mergedNames = Array.from(allNames);

				if (!DRY_RUN) {
					await db
						.update(schema.member)
						.set({ names: mergedNames })
						.where(eq(schema.member.id, canonical));
					console.log(`  ${canonical}: ${JSON.stringify(mergedNames)}`);
				} else {
					console.log(`  [DRY-RUN] ${canonical}: ${JSON.stringify(mergedNames)}`);
				}
			}

			// Step 7: Delete duplicate members
			console.log('\nDeleting duplicate members...');
			const duplicatesToDelete = validMappings.map((m) => m.duplicate);

			if (!DRY_RUN) {
				await db.delete(schema.member).where(inArray(schema.member.id, duplicatesToDelete));
				console.log(`Deleted ${duplicatesToDelete.length} duplicate members`);
			} else {
				console.log(
					`[DRY-RUN] Would delete ${duplicatesToDelete.length} members: ${duplicatesToDelete.join(', ')}`
				);
			}
		} // End of if (validMappings.length > 0)

		// ========================================
		// PART 2: Fix squished members (two people merged into one)
		// ========================================
		console.log('\n\n=== Processing Squished Members ===');
		console.log(`Processing ${SQUISHED_MAPPINGS.length} squished member mappings`);

		const squishedIds = SQUISHED_MAPPINGS.map((m) => m.squished);
		const targetIds = SQUISHED_MAPPINGS.flatMap((m) => m.targets);

		// Verify squished and target members exist
		const squishedMembers = await db
			.select()
			.from(schema.member)
			.where(inArray(schema.member.id, squishedIds));
		const targetMembers = await db
			.select()
			.from(schema.member)
			.where(inArray(schema.member.id, targetIds));

		const squishedMap = new Map(squishedMembers.map((m) => [m.id, m]));
		const targetMap = new Map(targetMembers.map((m) => [m.id, m]));

		// Check for missing squished members
		const missingSquishedIds = squishedIds.filter((id) => !squishedMap.has(id));
		if (missingSquishedIds.length > 0) {
			console.log(
				`Note: ${missingSquishedIds.length} squished members not found (already fixed?):`
			);
			missingSquishedIds.forEach((id) => console.log(`  - ${id}`));
		}

		// Check for missing target members
		const missingTargetIds = targetIds.filter((id) => !targetMap.has(id));
		if (missingTargetIds.length > 0) {
			console.error(`Error: ${missingTargetIds.length} target members not found!`);
			missingTargetIds.forEach((id) => console.log(`  - ${id}`));
			process.exit(1);
		}

		// Filter to valid squished mappings
		const validSquishedMappings = SQUISHED_MAPPINGS.filter(
			(m) =>
				squishedMap.has(m.squished) && targetMap.has(m.targets[0]) && targetMap.has(m.targets[1])
		);
		console.log(`Processing ${validSquishedMappings.length} valid squished mappings`);

		if (validSquishedMappings.length > 0) {
			// Get bill_supporters for squished members
			const existingSquishedIds = validSquishedMappings.map((m) => m.squished);
			const squishedSupporters = await db
				.select()
				.from(schema.billSupporters)
				.where(inArray(schema.billSupporters.memberId, existingSquishedIds));

			console.log(`\nFound ${squishedSupporters.length} bill_supporters records to split`);

			// Process each squished mapping
			for (const { squished, targets } of validSquishedMappings) {
				const memberSupporters = squishedSupporters.filter((s) => s.memberId === squished);
				if (memberSupporters.length === 0) continue;

				const squishedMember = squishedMap.get(squished);
				const target1 = targetMap.get(targets[0]);
				const target2 = targetMap.get(targets[1]);
				console.log(
					`\nSplitting ${memberSupporters.length} supporters from ${squished} (${squishedMember?.names[0]}) to:`
				);
				console.log(`  - ${targets[0]} (${target1?.names[0]})`);
				console.log(`  - ${targets[1]} (${target2?.names[0]})`);

				for (const target of targets) {
					// Check for existing supporters for this target
					const billIds = memberSupporters.map((s) => s.billId);
					const existingTargetSupporters = await db
						.select()
						.from(schema.billSupporters)
						.where(
							and(
								eq(schema.billSupporters.memberId, target),
								inArray(schema.billSupporters.billId, billIds)
							)
						);

					const existingBillIds = new Set(existingTargetSupporters.map((s) => s.billId));
					const toInsert = memberSupporters.filter((s) => !existingBillIds.has(s.billId));

					if (!DRY_RUN) {
						for (const s of toInsert) {
							await db.insert(schema.billSupporters).values({
								billId: s.billId,
								memberId: target
							});
						}
						console.log(`  Inserted ${toInsert.length} supporters for ${target}`);
					} else {
						console.log(`  [DRY-RUN] Would insert ${toInsert.length} supporters for ${target}`);
					}
				}

				// Delete the squished supporters
				if (!DRY_RUN) {
					for (const s of memberSupporters) {
						await db
							.delete(schema.billSupporters)
							.where(
								and(
									eq(schema.billSupporters.billId, s.billId),
									eq(schema.billSupporters.memberId, squished)
								)
							);
					}
					console.log(`  Deleted ${memberSupporters.length} supporters from squished ${squished}`);
				} else {
					console.log(
						`  [DRY-RUN] Would delete ${memberSupporters.length} supporters from squished ${squished}`
					);
				}
			}

			// Get bill_sponsors for squished members (if any)
			const squishedSponsors = await db
				.select()
				.from(schema.billSponsors)
				.where(inArray(schema.billSponsors.memberId, existingSquishedIds));

			if (squishedSponsors.length > 0) {
				console.log(`\nFound ${squishedSponsors.length} bill_sponsors records to split`);

				for (const { squished, targets } of validSquishedMappings) {
					const memberSponsors = squishedSponsors.filter((s) => s.memberId === squished);
					if (memberSponsors.length === 0) continue;

					console.log(`Splitting ${memberSponsors.length} sponsors from ${squished}`);

					for (const target of targets) {
						const billIds = memberSponsors.map((s) => s.billId);
						const existingTargetSponsors = await db
							.select()
							.from(schema.billSponsors)
							.where(
								and(
									eq(schema.billSponsors.memberId, target),
									inArray(schema.billSponsors.billId, billIds)
								)
							);

						const existingBillIds = new Set(existingTargetSponsors.map((s) => s.billId));
						const toInsert = memberSponsors.filter((s) => !existingBillIds.has(s.billId));

						if (!DRY_RUN) {
							for (const s of toInsert) {
								await db.insert(schema.billSponsors).values({
									billId: s.billId,
									memberId: target
								});
							}
							console.log(`  Inserted ${toInsert.length} sponsors for ${target}`);
						} else {
							console.log(`  [DRY-RUN] Would insert ${toInsert.length} sponsors for ${target}`);
						}
					}

					// Delete the squished sponsors
					if (!DRY_RUN) {
						for (const s of memberSponsors) {
							await db
								.delete(schema.billSponsors)
								.where(
									and(
										eq(schema.billSponsors.billId, s.billId),
										eq(schema.billSponsors.memberId, squished)
									)
								);
						}
						console.log(`  Deleted ${memberSponsors.length} sponsors from squished ${squished}`);
					} else {
						console.log(
							`  [DRY-RUN] Would delete ${memberSponsors.length} sponsors from squished ${squished}`
						);
					}
				}
			}

			// Delete squished members
			console.log('\nDeleting squished members...');
			const squishedToDelete = validSquishedMappings.map((m) => m.squished);

			if (!DRY_RUN) {
				await db.delete(schema.member).where(inArray(schema.member.id, squishedToDelete));
				console.log(`Deleted ${squishedToDelete.length} squished members`);
			} else {
				console.log(
					`[DRY-RUN] Would delete ${squishedToDelete.length} squished members: ${squishedToDelete.join(', ')}`
				);
			}
		}

		// ========================================
		// PART 3: Add missing member party info
		// ========================================
		console.log('\n\n=== Adding Missing Member Party Info ===');
		console.log(`Processing ${MISSING_MEMBER_PARTY.length} members with missing party info`);

		for (const memberInfo of MISSING_MEMBER_PARTY) {
			// Check if member exists
			const existingMember = await db
				.select()
				.from(schema.member)
				.where(eq(schema.member.id, memberInfo.memberId));

			if (existingMember.length === 0) {
				console.log(`Member ${memberInfo.memberId} not found, skipping`);
				continue;
			}

			const member = existingMember[0];
			console.log(`\nProcessing member ${memberInfo.memberId}: ${member.names[0]}`);

			// Update nameReading if not set
			if (!member.nameReading) {
				if (!DRY_RUN) {
					await db
						.update(schema.member)
						.set({ nameReading: memberInfo.nameReading })
						.where(eq(schema.member.id, memberInfo.memberId));
					console.log(`  Updated nameReading to: ${memberInfo.nameReading}`);
				} else {
					console.log(`  [DRY-RUN] Would update nameReading to: ${memberInfo.nameReading}`);
				}
			} else {
				console.log(`  nameReading already set: ${member.nameReading}`);
			}

			// Check if member_party record already exists
			const existingParty = await db
				.select()
				.from(schema.memberParty)
				.where(
					and(
						eq(schema.memberParty.memberId, memberInfo.memberId),
						eq(schema.memberParty.partyId, memberInfo.partyId)
					)
				);

			if (existingParty.length > 0) {
				console.log(`  member_party record already exists`);
				continue;
			}

			// Insert member_party record
			if (!DRY_RUN) {
				await db.insert(schema.memberParty).values({
					memberId: memberInfo.memberId,
					partyId: memberInfo.partyId,
					chamber: memberInfo.chamber,
					startDate: memberInfo.startDate,
					endDate: memberInfo.endDate
				});
				console.log(
					`  Inserted member_party: party=${memberInfo.partyId}, chamber=${memberInfo.chamber}, start=${memberInfo.startDate}`
				);
			} else {
				console.log(
					`  [DRY-RUN] Would insert member_party: party=${memberInfo.partyId}, chamber=${memberInfo.chamber}, start=${memberInfo.startDate}`
				);
			}
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
