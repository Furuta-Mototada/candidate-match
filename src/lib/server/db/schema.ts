import {
	pgTable,
	serial,
	integer,
	text,
	boolean,
	date,
	timestamp,
	unique,
	primaryKey,
	pgEnum,
	real
} from 'drizzle-orm/pg-core';

// Enums
export const chamberEnum = pgEnum('chamber', ['参議院', '衆議院']);
export const billTypeEnum = pgEnum('bill_type', ['衆法', '参法', '閣法']);
export const votingMethodEnum = pgEnum('voting_method', [
	'異議なし採決',
	'起立投票',
	'記名投票',
	'押しボタン'
]);

// Bill table
export const bill = pgTable(
	'bill',
	{
		id: serial('id').primaryKey(),
		type: billTypeEnum('type').notNull(), // 種類 (衆法/参法/閣法)
		submissionSession: integer('submission_session').notNull(), // 提出回次
		number: integer('number').notNull(), // 番号
		submissionDate: date('submission_date'), // 提出日
		deliberationCompleted: boolean('deliberation_completed').default(false), // 審議終了
		passed: boolean('passed').default(false) // 可決
	},
	(table) => [unique().on(table.type, table.submissionSession, table.number)]
);

export type Bill = typeof bill.$inferSelect;
export type NewBill = typeof bill.$inferInsert;

// Bill detail table
export const billDetail = pgTable('bill_detail', {
	billId: integer('bill_id')
		.primaryKey()
		.references(() => bill.id),
	title: text('title'), // 件名
	description: text('description') // 解説
});

export type BillDetail = typeof billDetail.$inferSelect;
export type NewBillDetail = typeof billDetail.$inferInsert;

// Committee table
export const committee = pgTable('committee', {
	id: serial('id').primaryKey(),
	chamber: chamberEnum('chamber').notNull(), // 議会 (参議院/衆議院)
	name: text('name').notNull() // 委員会名
});

export type Committee = typeof committee.$inferSelect;
export type NewCommittee = typeof committee.$inferInsert;

// Committee-Bill relation table
export const committeeBill = pgTable('committee_bill', {
	id: serial('id').primaryKey(),
	committeeId: integer('committee_id')
		.notNull()
		.references(() => committee.id),
	billId: integer('bill_id')
		.notNull()
		.references(() => bill.id),
	session: integer('session').notNull() // 回次
});

export type CommitteeBill = typeof committeeBill.$inferSelect;
export type NewCommitteeBill = typeof committeeBill.$inferInsert;

// Member table
export const member = pgTable('member', {
	id: serial('id').primaryKey(),
	name: text('name').notNull() // 議員名
});

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;

// Party table
export const party = pgTable('party', {
	id: serial('id').primaryKey(),
	name: text('name').notNull() // 政党名
});

export type Party = typeof party.$inferSelect;
export type NewParty = typeof party.$inferInsert;

// Member-Party relation table
export const memberParty = pgTable('member_party', {
	id: serial('id').primaryKey(),
	memberId: integer('member_id')
		.notNull()
		.references(() => member.id),
	partyId: integer('party_id')
		.notNull()
		.references(() => party.id),
	startDate: date('start_date'), // 所属開始日
	endDate: date('end_date') // 所属終了日
});

export type MemberParty = typeof memberParty.$inferSelect;
export type NewMemberParty = typeof memberParty.$inferInsert;

// Group table
export const group = pgTable('group', {
	id: serial('id').primaryKey(),
	name: text('name').notNull() // 会派名
});

export type Group = typeof group.$inferSelect;
export type NewGroup = typeof group.$inferInsert;

// Cabinet table
export const cabinet = pgTable('cabinet', {
	id: serial('id').primaryKey(),
	memberId: integer('member_id')
		.notNull()
		.references(() => member.id), // 総理大臣のmember ID
	startDate: date('start_date').notNull(), // 在職開始日
	endDate: date('end_date') // 在職終了日
});

export type Cabinet = typeof cabinet.$inferSelect;
export type NewCabinet = typeof cabinet.$inferInsert;

// Member-Group relation table
export const memberGroup = pgTable('member_group', {
	id: serial('id').primaryKey(),
	memberId: integer('member_id')
		.notNull()
		.references(() => member.id),
	groupId: integer('group_id')
		.notNull()
		.references(() => group.id),
	startDate: date('start_date'), // 所属開始日
	endDate: date('end_date') // 所属終了日
});

export type MemberGroup = typeof memberGroup.$inferSelect;
export type NewMemberGroup = typeof memberGroup.$inferInsert;

// Bill sponsors (many-to-many)
export const billSponsors = pgTable(
	'bill_sponsors',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		memberId: integer('member_id')
			.notNull()
			.references(() => member.id)
	},
	(table) => [primaryKey({ columns: [table.billId, table.memberId] })]
);

export type BillSponsor = typeof billSponsors.$inferSelect;
export type NewBillSponsor = typeof billSponsors.$inferInsert;

// Bill sponsor groups (many-to-many)
export const billSponsorGroups = pgTable(
	'bill_sponsor_groups',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		groupId: integer('group_id')
			.notNull()
			.references(() => group.id)
	},
	(table) => [primaryKey({ columns: [table.billId, table.groupId] })]
);

export type BillSponsorGroup = typeof billSponsorGroups.$inferSelect;
export type NewBillSponsorGroup = typeof billSponsorGroups.$inferInsert;

// Bill supporters (many-to-many)
export const billSupporters = pgTable(
	'bill_supporters',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		memberId: integer('member_id')
			.notNull()
			.references(() => member.id)
	},
	(table) => [primaryKey({ columns: [table.billId, table.memberId] })]
);

export type BillSupporter = typeof billSupporters.$inferSelect;
export type NewBillSupporter = typeof billSupporters.$inferInsert;

// Bill votes table
export const billVotes = pgTable('bill_votes', {
	id: serial('id').primaryKey(),
	billId: integer('bill_id')
		.notNull()
		.references(() => bill.id),
	chamber: chamberEnum('chamber').notNull(), // 議会 (衆議院/参議院)
	votingMethod: votingMethodEnum('voting_method').notNull(), // 表決形式 (異議なし採決/起立投票/記名投票/押しボタン)
	votingDate: date('voting_date') // 議決日
});

export type BillVote = typeof billVotes.$inferSelect;
export type NewBillVote = typeof billVotes.$inferInsert;

// Bill votes result by group
export const billVotesResultGroup = pgTable(
	'bill_votes_result_group',
	{
		billVotesId: integer('bill_votes_id')
			.notNull()
			.references(() => billVotes.id),
		groupId: integer('group_id')
			.notNull()
			.references(() => group.id),
		approved: boolean('approved').notNull() // 承認
	},
	(table) => [primaryKey({ columns: [table.billVotesId, table.groupId] })]
);

export type BillVotesResultGroup = typeof billVotesResultGroup.$inferSelect;
export type NewBillVotesResultGroup = typeof billVotesResultGroup.$inferInsert;

// Bill votes result by member
export const billVotesResultMember = pgTable(
	'bill_votes_result_member',
	{
		billVotesId: integer('bill_votes_id')
			.notNull()
			.references(() => billVotes.id),
		memberId: integer('member_id')
			.notNull()
			.references(() => member.id),
		approved: boolean('approved').notNull() // 承認
	},
	(table) => [primaryKey({ columns: [table.billVotesId, table.memberId] })]
);

export type BillVotesResultMember = typeof billVotesResultMember.$inferSelect;
export type NewBillVotesResultMember = typeof billVotesResultMember.$inferInsert;

// Bill embeddings table - stores vector embeddings for clustering
export const billEmbeddings = pgTable('bill_embeddings', {
	billId: integer('bill_id')
		.primaryKey()
		.references(() => bill.id),
	pdfUrl: text('pdf_url'), // URL to the PDF document
	textContent: text('text_content'), // Extracted text content from PDF
	embedding: text('embedding').notNull(), // JSON serialized vector (array of floats)
	embeddingModel: text('embedding_model').notNull(), // Model used for embedding (e.g., 'paraphrase-multilingual-mpnet-base-v2')
	createdAt: timestamp('created_at').notNull().defaultNow()
});

export type BillEmbedding = typeof billEmbeddings.$inferSelect;
export type NewBillEmbedding = typeof billEmbeddings.$inferInsert;

// Bill clusters table - stores clustering results
export const billClusters = pgTable('bill_clusters', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(), // User-provided name for this clustering run
	algorithm: text('algorithm').notNull(), // 'kmeans', 'hdbscan', etc.
	parameters: text('parameters').notNull(), // JSON of clustering parameters
	embeddingModel: text('embedding_model').notNull(), // Model used for the embeddings
	createdAt: timestamp('created_at').notNull().defaultNow()
});

export type BillCluster = typeof billClusters.$inferSelect;
export type NewBillCluster = typeof billClusters.$inferInsert;

// Bill cluster assignments - which bill belongs to which cluster
export const billClusterAssignments = pgTable(
	'bill_cluster_assignments',
	{
		clusterId: integer('cluster_id')
			.notNull()
			.references(() => billClusters.id),
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		clusterLabel: integer('cluster_label').notNull(), // The cluster number assigned
		distance: text('distance'), // Distance to cluster center (for kmeans) or other metric
		x: real('x'), // 2D visualization x coordinate (from t-SNE/UMAP)
		y: real('y') // 2D visualization y coordinate (from t-SNE/UMAP)
	},
	(table) => [primaryKey({ columns: [table.clusterId, table.billId] })]
);

export type BillClusterAssignment = typeof billClusterAssignments.$inferSelect;
export type NewBillClusterAssignment = typeof billClusterAssignments.$inferInsert;

// Bill cluster label names - LLM-generated names for each cluster label
export const billClusterLabelNames = pgTable(
	'bill_cluster_label_names',
	{
		clusterId: integer('cluster_id')
			.notNull()
			.references(() => billClusters.id),
		clusterLabel: integer('cluster_label').notNull(), // The cluster number
		name: text('name').notNull(), // LLM-generated name for this cluster
		description: text('description'), // LLM-generated description
		generatedAt: timestamp('generated_at').notNull().defaultNow()
	},
	(table) => [primaryKey({ columns: [table.clusterId, table.clusterLabel] })]
);

export type BillClusterLabelName = typeof billClusterLabelNames.$inferSelect;
export type NewBillClusterLabelName = typeof billClusterLabelNames.$inferInsert;

// Cluster vector results table - stores pre-calculated member vectors for matching
export const clusterVectorResults = pgTable('cluster_vector_results', {
	id: serial('id').primaryKey(),
	clusterId: integer('cluster_id')
		.notNull()
		.references(() => billClusters.id),
	clusterLabel: integer('cluster_label').notNull(), // The cluster number this result is for
	nComponents: integer('n_components').notNull(), // Number of PCA dimensions
	name: text('name').notNull(), // User-provided name for this calculation
	memberVectors: text('member_vectors').notNull(), // JSON: Record<string, number[]>
	memberNames: text('member_names').notNull(), // JSON: Record<string, string>
	billLoadings: text('bill_loadings').notNull(), // JSON: number[][]
	billIds: text('bill_ids').notNull(), // JSON: number[]
	explainedVariance: text('explained_variance').notNull(), // JSON: number[]
	dimensions: integer('dimensions').notNull(),
	memberCount: integer('member_count').notNull(),
	billCount: integer('bill_count').notNull(),
	representativeBills: text('representative_bills'), // JSON: RepresentativeBill[][]
	createdAt: timestamp('created_at').notNull().defaultNow()
});

export type ClusterVectorResult = typeof clusterVectorResults.$inferSelect;
export type NewClusterVectorResult = typeof clusterVectorResults.$inferInsert;

// Session status enum
export const sessionStatusEnum = pgEnum('session_status', ['in_progress', 'completed']);

// Saved matching sessions - stores user's complete matching session data
export const savedMatchingSession = pgTable('saved_matching_session', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	savedVectorKey: text('saved_vector_key').notNull(), // "name|clusterId" key for the saved vector group
	clusterId: integer('cluster_id')
		.notNull()
		.references(() => billClusters.id),
	nComponents: integer('n_components').notNull(),
	status: text('status').notNull().default('in_progress'), // 'in_progress' or 'completed'
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export type SavedMatchingSession = typeof savedMatchingSession.$inferSelect;
export type NewSavedMatchingSession = typeof savedMatchingSession.$inferInsert;

// Session cluster results - stores per-cluster results within a session
export const sessionClusterResult = pgTable(
	'session_cluster_result',
	{
		id: serial('id').primaryKey(),
		sessionId: integer('session_id')
			.notNull()
			.references(() => savedMatchingSession.id, { onDelete: 'cascade' }),
		clusterLabel: integer('cluster_label').notNull(),
		clusterLabelName: text('cluster_label_name'),
		userVector: text('user_vector').notNull(), // JSON: number[]
		importance: integer('importance').notNull().default(3), // 1-5 rating
		answeredCount: integer('answered_count').notNull().default(0),
		matchesJson: text('matches_json').notNull(), // JSON: MemberMatch[]
		memberVectorsVizJson: text('member_vectors_viz_json'), // JSON: MemberVectorForViz[]
		explainedVarianceJson: text('explained_variance_json'), // JSON: number[]
		userVectorHistoryJson: text('user_vector_history_json'), // JSON: number[][]
		xDimension: integer('x_dimension').default(0),
		yDimension: integer('y_dimension').default(1),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(table) => [unique().on(table.sessionId, table.clusterLabel)]
);

export type SessionClusterResult = typeof sessionClusterResult.$inferSelect;
export type NewSessionClusterResult = typeof sessionClusterResult.$inferInsert;

// Session answers - individual bill answers within a cluster result
export const sessionAnswer = pgTable(
	'session_answer',
	{
		id: serial('id').primaryKey(),
		clusterResultId: integer('cluster_result_id')
			.notNull()
			.references(() => sessionClusterResult.id, { onDelete: 'cascade' }),
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		billTitle: text('bill_title').notNull(),
		score: integer('score').notNull(), // -1, 0, or 1
		answeredAt: timestamp('answered_at').notNull().defaultNow()
	},
	(table) => [unique().on(table.clusterResultId, table.billId)]
);

export type SessionAnswer = typeof sessionAnswer.$inferSelect;
export type NewSessionAnswer = typeof sessionAnswer.$inferInsert;

// Result snapshots - point-in-time snapshots of matching results
export const resultSnapshot = pgTable(
	'result_snapshot',
	{
		id: serial('id').primaryKey(),
		sessionId: integer('session_id')
			.notNull()
			.references(() => savedMatchingSession.id, { onDelete: 'cascade' }),
		snapshotNumber: integer('snapshot_number').notNull().default(1),
		name: text('name'),
		globalScoresJson: text('global_scores_json').notNull(), // JSON: GlobalMemberScore[]
		clusterResultsJson: text('cluster_results_json').notNull(), // JSON: summary of cluster results at this point
		totalAnswered: integer('total_answered').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(table) => [unique().on(table.sessionId, table.snapshotNumber)]
);

export type ResultSnapshot = typeof resultSnapshot.$inferSelect;
export type NewResultSnapshot = typeof resultSnapshot.$inferInsert;

// ============================================================================
// Bill Enrichment Data (LLM-generated content for user education)
// ============================================================================

// Status enum for enrichment processing
export const enrichmentStatusEnum = pgEnum('enrichment_status', [
	'pending',
	'processing',
	'completed',
	'failed'
]);

// Bill enrichment table - LLM-generated summaries and educational content
export const billEnrichment = pgTable('bill_enrichment', {
	billId: integer('bill_id')
		.primaryKey()
		.references(() => bill.id),

	// One-line summary (50-80 chars)
	summaryShort: text('summary_short'),

	// Detailed plain-language summary
	summaryDetailed: text('summary_detailed'),

	// Key points as JSON array: [{ who: string, what: string, when: string }]
	keyPoints: text('key_points'),

	// Impact tags as JSON array: ["#子育て世帯", "#中小企業", ...]
	impactTags: text('impact_tags'),

	// Pros and cons as JSON: { pros: string[], cons: string[] }
	prosAndCons: text('pros_and_cons'),

	// Example scenario for understanding impact
	exampleScenario: text('example_scenario'),

	// Metadata
	status: enrichmentStatusEnum('status').notNull().default('pending'),
	llmModel: text('llm_model'), // Model used for generation (e.g., 'claude-3-5-sonnet')
	sourceTextHash: text('source_text_hash'), // Hash of source text to detect changes
	errorMessage: text('error_message'), // Error message if processing failed

	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export type BillEnrichment = typeof billEnrichment.$inferSelect;
export type NewBillEnrichment = typeof billEnrichment.$inferInsert;

// Bill debates table - records from Kokkai API (National Diet proceedings)
export const billDebates = pgTable('bill_debates', {
	id: serial('id').primaryKey(),
	billId: integer('bill_id')
		.notNull()
		.references(() => bill.id),

	// Meeting info from Kokkai API
	meetingId: text('meeting_id').notNull(), // issueID from API
	speechId: text('speech_id').notNull().unique(), // speechID from API
	session: integer('session').notNull(), // 国会回次
	house: text('house').notNull(), // 院名 (衆議院/参議院)
	meetingName: text('meeting_name').notNull(), // 会議名
	issueNumber: text('issue_number'), // 号数
	meetingDate: date('meeting_date'), // 開催日付

	// Speaker info
	speakerName: text('speaker_name').notNull(),
	speakerGroup: text('speaker_group'), // 所属会派
	speakerPosition: text('speaker_position'), // 肩書き
	speakerRole: text('speaker_role'), // 役割 (証人/参考人/公述人)

	// Speech content
	speechOrder: integer('speech_order'), // 発言番号
	speechContent: text('speech_content').notNull(), // Full speech text
	speechUrl: text('speech_url'), // Link to speech on Kokkai site

	// Classification (determined by analysis)
	speechType: text('speech_type'), // 'pro', 'con', 'neutral', 'explanation', 'question'

	createdAt: timestamp('created_at').notNull().defaultNow()
});

export type BillDebate = typeof billDebates.$inferSelect;
export type NewBillDebate = typeof billDebates.$inferInsert;

// Bill debate summary table - LLM-generated summaries of debates
export const billDebateSummary = pgTable('bill_debate_summary', {
	billId: integer('bill_id')
		.primaryKey()
		.references(() => bill.id),

	// Summary of pro arguments (JSON array of strings)
	proArgumentsSummary: text('pro_arguments_summary'),

	// Summary of con arguments (JSON array of strings)
	conArgumentsSummary: text('con_arguments_summary'),

	// Key questions raised during debates
	keyQuestions: text('key_questions'),

	// Government explanations/responses
	governmentExplanations: text('government_explanations'),

	// Total number of debate records
	debateCount: integer('debate_count').notNull().default(0),

	// Processing metadata
	status: enrichmentStatusEnum('status').notNull().default('pending'),
	llmModel: text('llm_model'),
	errorMessage: text('error_message'),

	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export type BillDebateSummary = typeof billDebateSummary.$inferSelect;
export type NewBillDebateSummary = typeof billDebateSummary.$inferInsert;
