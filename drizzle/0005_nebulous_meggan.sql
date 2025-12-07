CREATE TABLE "bill_cluster_assignments" (
	"cluster_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"cluster_label" integer NOT NULL,
	"distance" text,
	CONSTRAINT "bill_cluster_assignments_cluster_id_bill_id_pk" PRIMARY KEY("cluster_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "bill_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"algorithm" text NOT NULL,
	"parameters" text NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" date DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_embeddings" (
	"bill_id" integer PRIMARY KEY NOT NULL,
	"pdf_url" text,
	"text_content" text,
	"embedding" text NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" date DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_cluster_assignments" ADD CONSTRAINT "bill_cluster_assignments_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_cluster_assignments" ADD CONSTRAINT "bill_cluster_assignments_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_embeddings" ADD CONSTRAINT "bill_embeddings_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;