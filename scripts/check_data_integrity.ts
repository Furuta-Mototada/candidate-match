/**
 * Data integrity checks for the scraped legislation database.
 * Runs sanity checks and reports violations.
 *
 * Usage: tsx ./scripts/check_data_integrity.ts
 */

import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

interface CheckResult {
	name: string;
	passed: boolean;
	violations: number;
	details: string[];
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;
	if (!DATABASE_URL) {
		console.error('DATABASE_URL is not set.');
		process.exit(1);
	}

	const sql = postgres(DATABASE_URL);
	const results: CheckResult[] = [];

	try {
		console.log('=== Data Integrity Checks ===\n');

		// ────────────────────────────────────────────
		// CHECK 1: 閣法 → exactly 1 sponsor, 0 supporters, 0 sponsor_groups
		// ────────────────────────────────────────────
		{
			const rows = await sql`
				SELECT b.id, b.type, b.submission_session, b.number, b.title,
					COALESCE(sp.cnt, 0)::int AS sponsor_count,
					COALESCE(su.cnt, 0)::int AS supporter_count,
					COALESCE(sg.cnt, 0)::int AS sponsor_group_count
				FROM bill b
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsors GROUP BY bill_id) sp ON sp.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_supporters GROUP BY bill_id) su ON su.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsor_groups GROUP BY bill_id) sg ON sg.bill_id = b.id
				WHERE b.type = '閣法'
					AND (COALESCE(sp.cnt, 0) != 1 OR COALESCE(su.cnt, 0) != 0 OR COALESCE(sg.cnt, 0) != 0)
				ORDER BY b.submission_session, b.number
			`;
			const details = rows.map(
				(r) =>
					`  閣法-${r.submission_session}-${r.number}: sponsors=${r.sponsor_count}, supporters=${r.supporter_count}, groups=${r.sponsor_group_count}`
			);
			results.push({
				name: '閣法 → exactly 1 sponsor, 0 supporters, 0 sponsor_groups',
				passed: rows.length === 0,
				violations: rows.length,
				details
			});
		}

		// ────────────────────────────────────────────
		// CHECK 2: 参法 → ≥1 sponsor, 0 supporters, 0 sponsor_groups
		// ────────────────────────────────────────────
		{
			const rows = await sql`
				SELECT b.id, b.submission_session, b.number, b.title,
					COALESCE(sp.cnt, 0)::int AS sponsor_count,
					COALESCE(su.cnt, 0)::int AS supporter_count,
					COALESCE(sg.cnt, 0)::int AS sponsor_group_count
				FROM bill b
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsors GROUP BY bill_id) sp ON sp.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_supporters GROUP BY bill_id) su ON su.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsor_groups GROUP BY bill_id) sg ON sg.bill_id = b.id
				WHERE b.type = '参法'
					AND (COALESCE(sp.cnt, 0) < 1 OR COALESCE(su.cnt, 0) != 0 OR COALESCE(sg.cnt, 0) != 0)
				ORDER BY b.submission_session, b.number
			`;
			const details = rows.map(
				(r) =>
					`  参法-${r.submission_session}-${r.number}: sponsors=${r.sponsor_count}, supporters=${r.supporter_count}, groups=${r.sponsor_group_count}`
			);
			results.push({
				name: '参法 → ≥1 sponsor, 0 supporters, 0 sponsor_groups',
				passed: rows.length === 0,
				violations: rows.length,
				details
			});
		}

		// ────────────────────────────────────────────
		// CHECK 3: 衆法 with committeeName → exactly 1 sponsor, 0 supporters, 0 sponsor_groups
		// ────────────────────────────────────────────
		{
			const rows = await sql`
				SELECT b.id, b.submission_session, b.number, b.title, b.committee_name,
					COALESCE(sp.cnt, 0)::int AS sponsor_count,
					COALESCE(su.cnt, 0)::int AS supporter_count,
					COALESCE(sg.cnt, 0)::int AS sponsor_group_count
				FROM bill b
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsors GROUP BY bill_id) sp ON sp.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_supporters GROUP BY bill_id) su ON su.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsor_groups GROUP BY bill_id) sg ON sg.bill_id = b.id
				WHERE b.type = '衆法'
					AND b.committee_name IS NOT NULL
					AND (COALESCE(sp.cnt, 0) != 1 OR COALESCE(su.cnt, 0) != 0 OR COALESCE(sg.cnt, 0) != 0)
				ORDER BY b.submission_session, b.number
			`;
			const details = rows.map(
				(r) =>
					`  衆法-${r.submission_session}-${r.number} (${r.committee_name}): sponsors=${r.sponsor_count}, supporters=${r.supporter_count}, groups=${r.sponsor_group_count}`
			);
			results.push({
				name: '衆法 with committeeName → exactly 1 sponsor, 0 supporters, 0 sponsor_groups',
				passed: rows.length === 0,
				violations: rows.length,
				details
			});
		}

		// ────────────────────────────────────────────
		// CHECK 4: 衆法 without committeeName → ≥1 sponsor, ≥1 supporter, ≥1 sponsor_groups
		// ────────────────────────────────────────────
		{
			const rows = await sql`
				SELECT b.id, b.submission_session, b.number, b.title,
					COALESCE(sp.cnt, 0)::int AS sponsor_count,
					COALESCE(su.cnt, 0)::int AS supporter_count,
					COALESCE(sg.cnt, 0)::int AS sponsor_group_count
				FROM bill b
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsors GROUP BY bill_id) sp ON sp.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_supporters GROUP BY bill_id) su ON su.bill_id = b.id
				LEFT JOIN (SELECT bill_id, COUNT(*) AS cnt FROM bill_sponsor_groups GROUP BY bill_id) sg ON sg.bill_id = b.id
				WHERE b.type = '衆法'
					AND b.committee_name IS NULL
					AND (COALESCE(sp.cnt, 0) < 1 OR COALESCE(su.cnt, 0) < 1 OR COALESCE(sg.cnt, 0) < 1)
				ORDER BY b.submission_session, b.number
			`;
			const details = rows.map(
				(r) =>
					`  衆法-${r.submission_session}-${r.number}: sponsors=${r.sponsor_count}, supporters=${r.supporter_count}, groups=${r.sponsor_group_count}`
			);
			results.push({
				name: '衆法 without committeeName → ≥1 sponsor, ≥1 supporter, ≥1 sponsor_groups',
				passed: rows.length === 0,
				violations: rows.length,
				details
			});
		}

		// ────────────────────────────────────────────
		// CHECK 5: result=NULL only for the latest congress session
		// ────────────────────────────────────────────
		{
			const rows = await sql`
				WITH latest_session AS (
					SELECT MAX(session_number) AS session_number FROM congress_session
				)
				SELECT b.id, b.type, b.submission_session, b.number, b.title
				FROM bill b, latest_session ls
				WHERE b.result IS NULL
					AND b.submission_session != ls.session_number
				ORDER BY b.submission_session, b.type, b.number
			`;
			const details = rows.map(
				(r) => `  ${r.type}-${r.submission_session}-${r.number}: result is NULL`
			);
			results.push({
				name: 'result=NULL only for the latest congress session',
				passed: rows.length === 0,
				violations: rows.length,
				details
			});
		}

		// ────────────────────────────────────────────
		// CHECK 6: bill_votes_result_member only for 押しボタン votes on 参議院 chamber bills
		// ────────────────────────────────────────────
		{
			// 6a: result_member rows referencing non-押しボタン votes
			const nonPushButton = await sql`
				SELECT bvrm.bill_votes_id, bv.voting_method, bv.chamber, b.type, b.submission_session, b.number
				FROM bill_votes_result_member bvrm
				JOIN bill_votes bv ON bv.id = bvrm.bill_votes_id
				JOIN bill b ON b.id = bv.bill_id
				WHERE bv.voting_method != '押しボタン'
				LIMIT 50
			`;

			// 6b: 押しボタン votes that are NOT in 参議院 chamber
			const nonSangiin = await sql`
				SELECT DISTINCT bv.id, bv.chamber, bv.voting_method, b.type, b.submission_session, b.number
				FROM bill_votes bv
				JOIN bill b ON b.id = bv.bill_id
				WHERE bv.voting_method = '押しボタン'
					AND bv.chamber != '参議院'
				LIMIT 50
			`;

			const details = [
				...nonPushButton.map(
					(r) =>
						`  result_member on non-押しボタン vote: ${r.type}-${r.submission_session}-${r.number} (method=${r.voting_method}, chamber=${r.chamber})`
				),
				...nonSangiin.map(
					(r) =>
						`  押しボタン vote in non-参議院: ${r.type}-${r.submission_session}-${r.number} (chamber=${r.chamber})`
				)
			];

			const totalViolations = nonPushButton.length + nonSangiin.length;
			results.push({
				name: 'bill_votes_result_member only for 押しボタン votes in 参議院',
				passed: totalViolations === 0,
				violations: totalViolations,
				details
			});
		}

		// ────────────────────────────────────────────
		// CHECK 7: bill_votes_result_group only for 衆議院 votes
		// ────────────────────────────────────────────
		{
			const rows = await sql`
				SELECT DISTINCT bvrg.bill_votes_id, bv.chamber, bv.voting_method, b.type, b.submission_session, b.number
				FROM bill_votes_result_group bvrg
				JOIN bill_votes bv ON bv.id = bvrg.bill_votes_id
				JOIN bill b ON b.id = bv.bill_id
				WHERE bv.chamber != '衆議院'
				LIMIT 50
			`;
			const details = rows.map(
				(r) =>
					`  result_group on non-衆議院 vote: ${r.type}-${r.submission_session}-${r.number} (chamber=${r.chamber})`
			);
			results.push({
				name: 'bill_votes_result_group only for 衆議院 votes',
				passed: rows.length === 0,
				violations: rows.length,
				details
			});
		}

		// ────────────────────────────────────────────
		// SUMMARY
		// ────────────────────────────────────────────
		console.log('');
		let failed = 0;
		for (const r of results) {
			const status = r.passed ? '✅ PASS' : '❌ FAIL';
			console.log(`${status}  ${r.name}`);
			if (!r.passed) {
				failed++;
				console.log(`       ${r.violations} violation(s):`);
				const maxShow = 20;
				for (const d of r.details.slice(0, maxShow)) {
					console.log(d);
				}
				if (r.details.length > maxShow) {
					console.log(`       ... and ${r.details.length - maxShow} more`);
				}
			}
		}

		console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
		if (failed > 0) {
			process.exit(1);
		}
	} finally {
		await sql.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
