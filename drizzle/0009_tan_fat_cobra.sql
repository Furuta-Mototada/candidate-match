CREATE TABLE "cluster_vector_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"cluster_label" integer NOT NULL,
	"n_components" integer NOT NULL,
	"name" text NOT NULL,
	"member_vectors" text NOT NULL,
	"member_names" text NOT NULL,
	"bill_loadings" text NOT NULL,
	"bill_ids" text NOT NULL,
	"explained_variance" text NOT NULL,
	"dimensions" integer NOT NULL,
	"member_count" integer NOT NULL,
	"bill_count" integer NOT NULL,
	"representative_bills" text,
	"created_at" date DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cluster_vector_results" ADD CONSTRAINT "cluster_vector_results_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE no action ON UPDATE no action;