export interface SavedVectorInfo {
	id: number;
	clusterId: number;
	clusterLabel: number;
	clusterLabelName: string | null;
	nComponents: number;
	name: string;
	dimensions: number;
	memberCount: number;
	billCount: number;
	createdAt: string;
}

export interface GroupedSavedVector {
	key: string; // "name|clusterId" for grouping
	name: string;
	clusterId: number;
	nComponents: number;
	dimensions: number;
	clusterCount: number;
	totalMembers: number;
	totalBills: number;
	vectors: SavedVectorInfo[]; // All cluster labels in this group
	createdAt: string;
}

export interface Bill {
	billId: number;
	title: string;
	description: string | null;
	passed: boolean;
	reason: string;
	dimensionTarget: number;
}

export interface MemberMatch {
	memberId: number;
	name: string;
	group: string | null;
	similarity: number;
	rank: number;
	latentVector?: number[];
}

/** Common fields shared between live ClusterResult and SnapshotClusterResult */
export interface BaseClusterResult {
	clusterLabel: number;
	clusterLabelName: string | null;
	matches: { memberId: number; name: string; group: string | null; similarity: number }[];
	answeredCount: number;
	importance: number; // 1-5 stars
	answeredBills?: {
		billId: number;
		title: string;
		answer: number; // 1=Agree, -1=Disagree, 0=Neutral/Skip
	}[];
}

export interface ClusterResult extends BaseClusterResult {
	matches: MemberMatch[];
	userVector: number[];
	// Visualization data
	memberVectorsForViz: MemberVectorForViz[];
	explainedVariance: number[];
	userVectorHistory: number[][];
	xDimension: number;
	yDimension: number;
}

export interface MemberVectorForViz {
	memberId: number;
	name: string;
	group: string | null;
	latentVector: number[];
}

export interface GlobalMemberScore {
	memberId: number;
	name: string;
	group: string | null;
	globalScore: number;
	clusterScores: Record<number, number>; // clusterLabel -> similarity
}

export type MatchingPhase =
	| 'setup'
	| 'questioning'
	| 'rating'
	| 'cluster-results'
	| 'global-results';

// ============================================================================
// Saved Data Types
// ============================================================================

export interface AnsweredBill {
	billId: number;
	title: string;
	answer: number; // -1, 0, or 1
}

export interface ResultSnapshotData {
	id: number;
	clusterId: number;
	nComponents: number;
	name: string;
	globalScores: GlobalMemberScore[];
	clusterResults: SnapshotClusterResult[];
	totalAnswered: number;
	createdAt: string;
}

export type SnapshotClusterResult = BaseClusterResult;

export interface SnapshotListItem {
	id: number;
	name: string;
	clusterId: number;
	nComponents: number;
	totalAnswered: number;
	topMatch: { name: string; score: number } | null;
	createdAt: string;
}

export interface UserAnswerSummary {
	totalAnswers: number;
	answers: AnsweredBill[];
}

// ============================================================================
// Bill Enrichment Types
// ============================================================================

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
