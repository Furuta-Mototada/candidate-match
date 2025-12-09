-- Saved matching sessions table - stores user's complete matching session data
CREATE TABLE IF NOT EXISTS "saved_matching_session" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"saved_vector_key" text NOT NULL,
	"cluster_id" integer NOT NULL REFERENCES "bill_clusters"("id"),
	"n_components" integer NOT NULL,
	"status" text NOT NULL DEFAULT 'in_progress',
	"created_at" date DEFAULT now() NOT NULL,
	"updated_at" date DEFAULT now() NOT NULL
);

-- Session cluster results - stores per-cluster results within a session
CREATE TABLE IF NOT EXISTS "session_cluster_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL REFERENCES "saved_matching_session"("id") ON DELETE CASCADE,
	"cluster_label" integer NOT NULL,
	"cluster_label_name" text,
	"user_vector" text NOT NULL,
	"importance" integer NOT NULL DEFAULT 3,
	"answered_count" integer NOT NULL DEFAULT 0,
	"matches_json" text NOT NULL,
	"member_vectors_viz_json" text,
	"explained_variance_json" text,
	"user_vector_history_json" text,
	"x_dimension" integer DEFAULT 0,
	"y_dimension" integer DEFAULT 1,
	"created_at" date DEFAULT now() NOT NULL,
	"updated_at" date DEFAULT now() NOT NULL,
	UNIQUE("session_id", "cluster_label")
);

-- Session answers - individual bill answers within a cluster result
CREATE TABLE IF NOT EXISTS "session_answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_result_id" integer NOT NULL REFERENCES "session_cluster_result"("id") ON DELETE CASCADE,
	"bill_id" integer NOT NULL REFERENCES "bill"("id"),
	"bill_title" text NOT NULL,
	"score" integer NOT NULL,
	"answered_at" date DEFAULT now() NOT NULL,
	UNIQUE("cluster_result_id", "bill_id")
);

-- Result snapshots - point-in-time snapshots of matching results
CREATE TABLE IF NOT EXISTS "result_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL REFERENCES "saved_matching_session"("id") ON DELETE CASCADE,
	"snapshot_number" integer NOT NULL DEFAULT 1,
	"name" text,
	"global_scores_json" text NOT NULL,
	"cluster_results_json" text NOT NULL,
	"total_answered" integer NOT NULL,
	"created_at" date DEFAULT now() NOT NULL,
	UNIQUE("session_id", "snapshot_number")
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_session_cluster_result_session" ON "session_cluster_result"("session_id");
CREATE INDEX IF NOT EXISTS "idx_session_answer_cluster_result" ON "session_answer"("cluster_result_id");
CREATE INDEX IF NOT EXISTS "idx_result_snapshot_session" ON "result_snapshot"("session_id");
CREATE INDEX IF NOT EXISTS "idx_saved_matching_session_status" ON "saved_matching_session"("status");
