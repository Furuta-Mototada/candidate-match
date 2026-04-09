CREATE TABLE "evaluation_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_cluster_assignments" DROP CONSTRAINT "bill_cluster_assignments_cluster_id_bill_clusters_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_cluster_assignments" DROP CONSTRAINT "bill_cluster_assignments_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_cluster_label_names" DROP CONSTRAINT "bill_cluster_label_names_cluster_id_bill_clusters_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_debate_summary" DROP CONSTRAINT "bill_debate_summary_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_debates" DROP CONSTRAINT "bill_debates_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_embeddings" DROP CONSTRAINT "bill_embeddings_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_enrichment" DROP CONSTRAINT "bill_enrichment_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_session" DROP CONSTRAINT "bill_session_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_sponsor_groups" DROP CONSTRAINT "bill_sponsor_groups_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_sponsors" DROP CONSTRAINT "bill_sponsors_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_supporters" DROP CONSTRAINT "bill_supporters_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_votes" DROP CONSTRAINT "bill_votes_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_votes_result_group" DROP CONSTRAINT "bill_votes_result_group_bill_votes_id_bill_votes_id_fk";
--> statement-breakpoint
ALTER TABLE "bill_votes_result_member" DROP CONSTRAINT "bill_votes_result_member_bill_votes_id_bill_votes_id_fk";
--> statement-breakpoint
ALTER TABLE "cluster_vector_results" DROP CONSTRAINT "cluster_vector_results_cluster_id_bill_clusters_id_fk";
--> statement-breakpoint
ALTER TABLE "committee_bill" DROP CONSTRAINT "committee_bill_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "result_snapshot" DROP CONSTRAINT "result_snapshot_cluster_id_bill_clusters_id_fk";
--> statement-breakpoint
ALTER TABLE "user_bill_answer" DROP CONSTRAINT "user_bill_answer_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "vote_delegation" DROP CONSTRAINT "vote_delegation_bill_id_bill_id_fk";
--> statement-breakpoint
ALTER TABLE "evaluation_run" ADD CONSTRAINT "evaluation_run_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_cluster_assignments" ADD CONSTRAINT "bill_cluster_assignments_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_cluster_assignments" ADD CONSTRAINT "bill_cluster_assignments_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_cluster_label_names" ADD CONSTRAINT "bill_cluster_label_names_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_debate_summary" ADD CONSTRAINT "bill_debate_summary_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_debates" ADD CONSTRAINT "bill_debates_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_embeddings" ADD CONSTRAINT "bill_embeddings_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_enrichment" ADD CONSTRAINT "bill_enrichment_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_session" ADD CONSTRAINT "bill_session_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsor_groups" ADD CONSTRAINT "bill_sponsor_groups_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_supporters" ADD CONSTRAINT "bill_supporters_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes" ADD CONSTRAINT "bill_votes_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes_result_group" ADD CONSTRAINT "bill_votes_result_group_bill_votes_id_bill_votes_id_fk" FOREIGN KEY ("bill_votes_id") REFERENCES "public"."bill_votes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes_result_member" ADD CONSTRAINT "bill_votes_result_member_bill_votes_id_bill_votes_id_fk" FOREIGN KEY ("bill_votes_id") REFERENCES "public"."bill_votes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_vector_results" ADD CONSTRAINT "cluster_vector_results_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_bill" ADD CONSTRAINT "committee_bill_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD CONSTRAINT "result_snapshot_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bill_answer" ADD CONSTRAINT "user_bill_answer_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_delegation" ADD CONSTRAINT "vote_delegation_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE cascade ON UPDATE no action;