CREATE TABLE "bill_cluster_label_names" (
	"cluster_id" integer NOT NULL,
	"cluster_label" integer NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"description" text,
	"generated_at" date DEFAULT now() NOT NULL,
	CONSTRAINT "bill_cluster_label_names_cluster_id_cluster_label_pk" PRIMARY KEY("cluster_id","cluster_label")
);
--> statement-breakpoint
ALTER TABLE "bill_cluster_label_names" ADD CONSTRAINT "bill_cluster_label_names_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE no action ON UPDATE no action;