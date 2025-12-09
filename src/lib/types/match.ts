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
