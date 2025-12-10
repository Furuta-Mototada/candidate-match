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

export interface ClusterResult {
	clusterLabel: number;
	clusterLabelName: string | null;
	matches: MemberMatch[];
	answeredCount: number;
	importance: number; // 1-5 stars
	userVector: number[];
	// Visualization data
	memberVectorsForViz: MemberVectorForViz[];
	explainedVariance: number[];
	userVectorHistory: number[][];
	xDimension: number;
	yDimension: number;
	// Answer history
	answeredBills?: {
		billId: number;
		title: string;
		answer: number; // 1=Agree, -1=Disagree, 0=Neutral/Skip
	}[];
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
// Saved Session Types
// ============================================================================

export type SessionStatus = 'in_progress' | 'completed';

export interface SavedMatchingSession {
	id: number;
	name: string;
	description: string | null;
	savedVectorKey: string; // "name|clusterId" key for the saved vector group
	clusterId: number;
	nComponents: number;
	status: SessionStatus;
	createdAt: string;
	updatedAt: string;
}

export interface SessionClusterResultData {
	id: number;
	sessionId: number;
	clusterLabel: number;
	clusterLabelName: string | null;
	userVector: number[];
	importance: number;
	answeredCount: number;
	matches: MemberMatch[];
	memberVectorsForViz?: MemberVectorForViz[];
	explainedVariance?: number[];
	userVectorHistory?: number[][];
	xDimension: number;
	yDimension: number;
	answeredBills: AnsweredBill[];
	createdAt: string;
	updatedAt: string;
}

export interface AnsweredBill {
	billId: number;
	title: string;
	answer: number; // -1, 0, or 1
}

export interface ResultSnapshotData {
	id: number;
	sessionId: number;
	snapshotNumber: number;
	name: string | null;
	globalScores: GlobalMemberScore[];
	clusterResults: SnapshotClusterResult[];
	totalAnswered: number;
	createdAt: string;
}

export interface SnapshotClusterResult {
	clusterLabel: number;
	clusterLabelName: string | null;
	answeredCount: number;
	importance: number;
	matches: { memberId: number; name: string; group: string | null; similarity: number }[];
	answeredBills?: { billId: number; title: string; answer: number }[];
}

export interface ClusterResultSummary {
	clusterLabel: number;
	clusterLabelName: string | null;
	answeredCount: number;
	importance: number;
	topMatches: { memberId: number; name: string; similarity: number }[];
}

export interface SavedSessionWithDetails extends SavedMatchingSession {
	clusterResults: SessionClusterResultData[];
	snapshots: ResultSnapshotData[];
	totalAnswered: number;
	totalBills: number;
	globalScores?: GlobalMemberScore[];
}

export interface SavedSessionListItem {
	id: number;
	name: string;
	description: string | null;
	status: SessionStatus;
	totalAnswered: number;
	totalBills: number;
	clusterCount: number;
	latestSnapshotDate: string | null;
	createdAt: string;
	updatedAt: string;
}

// For resuming a session - contains unanswered bills info
export interface ResumableClusterInfo {
	clusterLabel: number;
	clusterLabelName: string | null;
	answeredBillIds: number[];
	totalBills: number;
	remainingBills: number;
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
