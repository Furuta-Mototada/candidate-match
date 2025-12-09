CREATE TYPE "public"."session_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "result_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"snapshot_number" integer DEFAULT 1 NOT NULL,
	"name" text,
	"global_scores_json" text NOT NULL,
	"cluster_results_json" text NOT NULL,
	"total_answered" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "result_snapshot_session_id_snapshot_number_unique" UNIQUE("session_id","snapshot_number")
);
--> statement-breakpoint
CREATE TABLE "saved_matching_session" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"saved_vector_key" text NOT NULL,
	"cluster_id" integer NOT NULL,
	"n_components" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_result_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"bill_title" text NOT NULL,
	"score" integer NOT NULL,
	"answered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_answer_cluster_result_id_bill_id_unique" UNIQUE("cluster_result_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "session_cluster_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"cluster_label" integer NOT NULL,
	"cluster_label_name" text,
	"user_vector" text NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"matches_json" text NOT NULL,
	"member_vectors_viz_json" text,
	"explained_variance_json" text,
	"user_vector_history_json" text,
	"x_dimension" integer DEFAULT 0,
	"y_dimension" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_cluster_result_session_id_cluster_label_unique" UNIQUE("session_id","cluster_label")
);
--> statement-breakpoint
ALTER TABLE "bill_cluster_label_names" ALTER COLUMN "generated_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "bill_cluster_label_names" ALTER COLUMN "generated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "bill_clusters" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "bill_clusters" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "bill_embeddings" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "bill_embeddings" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "cluster_vector_results" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "cluster_vector_results" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD CONSTRAINT "result_snapshot_session_id_saved_matching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."saved_matching_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_matching_session" ADD CONSTRAINT "saved_matching_session_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_answer" ADD CONSTRAINT "session_answer_cluster_result_id_session_cluster_result_id_fk" FOREIGN KEY ("cluster_result_id") REFERENCES "public"."session_cluster_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_answer" ADD CONSTRAINT "session_answer_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_cluster_result" ADD CONSTRAINT "session_cluster_result_session_id_saved_matching_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."saved_matching_session"("id") ON DELETE cascade ON UPDATE no action;