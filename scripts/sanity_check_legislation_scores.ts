import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MemberLegislationScore {
	memberId: number;
	memberName: string;
	score: number;
	breakdown: string[];
}

interface LegislationScore {
	billId: number;
	billTitle: string;
	billType: string;
	billNumber: number;
	session: number;
	submissionDate: string | null;
	result: string | null;
	memberScores: MemberLegislationScore[];
	totalPositive: number;
	totalNegative: number;
	averageScore: number;
}

// Submission categories (mutually exclusive)
type SubmissionCategory = 'sponsor' | 'supporter' | 'group' | 'none';

// Voting categories
type VotingCategory = 'shu_approve' | 'shu_oppose' | 'san_approve' | 'san_oppose' | 'none';

// Labels in the breakdown
const SUBMISSION_LABELS: Record<string, SubmissionCategory> = {
	'Bill Sponsor: +10': 'sponsor',
	'Bill Supporter: +5': 'supporter',
	'Sponsoring Group Member: +2': 'group',
	"Sponsor's Group Member: +2": 'group'
};

const VOTING_LABELS: Record<string, VotingCategory> = {
	'House of Representatives - Approved Group: +2': 'shu_approve',
	'House of Representatives - Opposed Group: -2': 'shu_oppose',
	'House of Councillors - Approved: +5': 'san_approve',
	'House of Councillors - Opposed: -5': 'san_oppose'
};

const SUBMISSION_NAMES: Record<SubmissionCategory, string> = {
	sponsor: '議案提出者 (Bill Sponsor)',
	supporter: '賛成者 (Bill Supporter)',
	group: '会派メンバー (Group Member)',
	none: 'なし (None)'
};

const VOTING_NAMES: Record<VotingCategory, string> = {
	shu_approve: '衆議院賛成 (Shu Approve)',
	shu_oppose: '衆議院反対 (Shu Oppose)',
	san_approve: '参議院賛成 (San Approve)',
	san_oppose: '参議院反対 (San Oppose)',
	none: 'なし (None)'
};

function classifyMember(breakdown: string[]): {
	submission: SubmissionCategory;
	votingCategories: VotingCategory[];
	unknownLabels: string[];
} {
	let submission: SubmissionCategory = 'none';
	const votingCategories: VotingCategory[] = [];
	const unknownLabels: string[] = [];

	for (const label of breakdown) {
		if (label in SUBMISSION_LABELS) {
			submission = SUBMISSION_LABELS[label];
		} else if (label in VOTING_LABELS) {
			votingCategories.push(VOTING_LABELS[label]);
		} else {
			unknownLabels.push(label);
		}
	}

	return { submission, votingCategories, unknownLabels };
}

function main() {
	const jsonPath = path.join(__dirname, '..', 'static', 'data', 'legislation_scores.json');

	if (!fs.existsSync(jsonPath)) {
		console.error(`File not found: ${jsonPath}`);
		process.exit(1);
	}

	const data: LegislationScore[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
	console.log(`Loaded ${data.length} bills\n`);

	// Track pattern counts: key = "submission|voting"
	const patternCounts = new Map<string, number>();
	const patternExamples = new Map<
		string,
		{ billId: number; memberId: number; memberName: string; breakdown: string[] }
	>();

	// Track violations
	let multipleSubmissionCount = 0;
	const multipleSubmissionExamples: {
		billId: number;
		memberId: number;
		memberName: string;
		breakdown: string[];
	}[] = [];
	let unknownLabelCount = 0;
	const unknownLabelExamples: { billId: number; label: string }[] = [];

	// Track members with multiple different voting categories per bill
	let mixedVotingCount = 0;
	const mixedVotingExamples: {
		billId: number;
		memberId: number;
		memberName: string;
		breakdown: string[];
	}[] = [];

	for (const bill of data) {
		for (const member of bill.memberScores) {
			const { submission, votingCategories, unknownLabels } = classifyMember(member.breakdown);

			// Check for unknown labels
			if (unknownLabels.length > 0) {
				unknownLabelCount += unknownLabels.length;
				for (const label of unknownLabels) {
					if (unknownLabelExamples.length < 5) {
						unknownLabelExamples.push({ billId: bill.billId, label });
					}
				}
			}

			// Check for multiple submission categories
			const submissionLabels = member.breakdown.filter((l) => l in SUBMISSION_LABELS);
			if (submissionLabels.length > 1) {
				multipleSubmissionCount++;
				if (multipleSubmissionExamples.length < 5) {
					multipleSubmissionExamples.push({
						billId: bill.billId,
						memberId: member.memberId,
						memberName: member.memberName,
						breakdown: member.breakdown
					});
				}
			}

			// Determine the voting pattern (deduplicate to unique categories)
			const uniqueVotingSet = new Set(votingCategories);
			const uniqueVoting = Array.from(uniqueVotingSet);

			// Check for mixed voting (e.g., both approve and oppose, or both chambers)
			if (uniqueVoting.length > 1) {
				mixedVotingCount++;
				if (mixedVotingExamples.length < 5) {
					mixedVotingExamples.push({
						billId: bill.billId,
						memberId: member.memberId,
						memberName: member.memberName,
						breakdown: member.breakdown
					});
				}
			}

			// Build pattern key
			const votingKey = uniqueVoting.length === 0 ? 'none' : uniqueVoting.sort().join('+');
			const patternKey = `${submission}|${votingKey}`;

			patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
			if (!patternExamples.has(patternKey)) {
				patternExamples.set(patternKey, {
					billId: bill.billId,
					memberId: member.memberId,
					memberName: member.memberName,
					breakdown: member.breakdown
				});
			}
		}
	}

	// Print results
	console.log('='.repeat(80));
	console.log('SANITY CHECK: Legislation Score Patterns');
	console.log('='.repeat(80));

	// Expected patterns: 4 submission × 5 voting = 20
	const expectedSubmissions: SubmissionCategory[] = ['sponsor', 'supporter', 'group', 'none'];
	const expectedVotings: VotingCategory[] = [
		'shu_approve',
		'shu_oppose',
		'san_approve',
		'san_oppose',
		'none'
	];

	console.log('\n--- Pattern Distribution ---\n');
	console.log(`${'Submission'.padEnd(35)} ${'Voting'.padEnd(35)} ${'Count'.padStart(10)}`);
	console.log('-'.repeat(82));

	const sortedPatterns = Array.from(patternCounts.entries()).sort((a, b) => b[1] - a[1]);

	let totalMembers = 0;
	let expectedPatternCount = 0;
	let unexpectedPatternCount = 0;

	for (const [key, count] of sortedPatterns) {
		const [sub, vot] = key.split('|');
		totalMembers += count;

		// Check if this is an expected simple pattern
		const isExpected =
			expectedSubmissions.includes(sub as SubmissionCategory) &&
			expectedVotings.includes(vot as VotingCategory);

		const marker = isExpected ? '  ' : '⚠ ';

		const subName = SUBMISSION_NAMES[sub as SubmissionCategory] || sub;
		const votName = VOTING_NAMES[vot as VotingCategory] || vot;

		console.log(
			`${marker}${subName.padEnd(33)} ${votName.padEnd(35)} ${count.toString().padStart(10)}`
		);

		if (isExpected) {
			expectedPatternCount++;
		} else {
			unexpectedPatternCount++;
		}
	}

	console.log('-'.repeat(82));
	console.log(`${'Total member-bill entries:'.padEnd(70)} ${totalMembers.toString().padStart(10)}`);

	// Summary
	console.log('\n--- Summary ---\n');
	console.log(`Total unique patterns found: ${sortedPatterns.length}`);
	console.log(`  Expected (simple 4×5):     ${expectedPatternCount}`);
	console.log(`  Unexpected (compound):     ${unexpectedPatternCount}`);

	// Print unexpected pattern details
	if (unexpectedPatternCount > 0) {
		console.log('\n--- Unexpected Pattern Examples ---\n');
		for (const [key] of sortedPatterns) {
			const [sub, vot] = key.split('|');
			const isExpected =
				expectedSubmissions.includes(sub as SubmissionCategory) &&
				expectedVotings.includes(vot as VotingCategory);
			if (!isExpected) {
				const example = patternExamples.get(key)!;
				console.log(`  Pattern: ${key}`);
				console.log(
					`    Example: Bill ${example.billId}, Member ${example.memberId} (${example.memberName})`
				);
				console.log(`    Breakdown: ${JSON.stringify(example.breakdown)}`);
				console.log();
			}
		}
	}

	// Violation reports
	if (multipleSubmissionCount > 0) {
		console.log(
			`\n⚠ VIOLATION: ${multipleSubmissionCount} members have multiple submission categories`
		);
		for (const ex of multipleSubmissionExamples) {
			console.log(
				`  Bill ${ex.billId}, Member ${ex.memberId} (${ex.memberName}): ${JSON.stringify(ex.breakdown)}`
			);
		}
	} else {
		console.log('\n✓ No multiple submission category violations');
	}

	if (mixedVotingCount > 0) {
		console.log(
			`\n⚠ NOTE: ${mixedVotingCount} members have multiple voting categories for a single bill`
		);
		console.log('  (This can happen when there are multiple bill_votes per chamber)');
		for (const ex of mixedVotingExamples) {
			console.log(
				`  Bill ${ex.billId}, Member ${ex.memberId} (${ex.memberName}): ${JSON.stringify(ex.breakdown)}`
			);
		}
	} else {
		console.log('✓ No mixed voting category cases');
	}

	if (unknownLabelCount > 0) {
		console.log(`\n⚠ VIOLATION: ${unknownLabelCount} unknown breakdown labels`);
		for (const ex of unknownLabelExamples) {
			console.log(`  Bill ${ex.billId}: "${ex.label}"`);
		}
	} else {
		console.log('✓ No unknown breakdown labels');
	}

	// Final verdict
	console.log('\n' + '='.repeat(80));
	if (multipleSubmissionCount === 0 && unknownLabelCount === 0 && unexpectedPatternCount === 0) {
		console.log('✓ PASS: All patterns are within the expected 4×5 = 20 combinations');
	} else {
		console.log('⚠ ISSUES FOUND: See details above');
	}
	console.log('='.repeat(80));
}

main();
