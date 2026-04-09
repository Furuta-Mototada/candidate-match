-- Standardize ON DELETE behavior for foreign keys.
-- Bill child data → CASCADE, cluster child data → CASCADE, notification.billId → SET NULL.

-- bill_session.bill_id
ALTER TABLE "bill_session" DROP CONSTRAINT IF EXISTS "bill_session_bill_id_bill_id_fk";
ALTER TABLE "bill_session" ADD CONSTRAINT "bill_session_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- committee_bill.bill_id
ALTER TABLE "committee_bill" DROP CONSTRAINT IF EXISTS "committee_bill_bill_id_bill_id_fk";
ALTER TABLE "committee_bill" ADD CONSTRAINT "committee_bill_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_sponsors.bill_id
ALTER TABLE "bill_sponsors" DROP CONSTRAINT IF EXISTS "bill_sponsors_bill_id_bill_id_fk";
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_sponsor_groups.bill_id
ALTER TABLE "bill_sponsor_groups" DROP CONSTRAINT IF EXISTS "bill_sponsor_groups_bill_id_bill_id_fk";
ALTER TABLE "bill_sponsor_groups" ADD CONSTRAINT "bill_sponsor_groups_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_supporters.bill_id
ALTER TABLE "bill_supporters" DROP CONSTRAINT IF EXISTS "bill_supporters_bill_id_bill_id_fk";
ALTER TABLE "bill_supporters" ADD CONSTRAINT "bill_supporters_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_votes.bill_id
ALTER TABLE "bill_votes" DROP CONSTRAINT IF EXISTS "bill_votes_bill_id_bill_id_fk";
ALTER TABLE "bill_votes" ADD CONSTRAINT "bill_votes_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_votes_result_group.bill_votes_id
ALTER TABLE "bill_votes_result_group" DROP CONSTRAINT IF EXISTS "bill_votes_result_group_bill_votes_id_bill_votes_id_fk";
ALTER TABLE "bill_votes_result_group" ADD CONSTRAINT "bill_votes_result_group_bill_votes_id_bill_votes_id_fk"
  FOREIGN KEY ("bill_votes_id") REFERENCES "bill_votes"("id") ON DELETE CASCADE;

-- bill_votes_result_member.bill_votes_id
ALTER TABLE "bill_votes_result_member" DROP CONSTRAINT IF EXISTS "bill_votes_result_member_bill_votes_id_bill_votes_id_fk";
ALTER TABLE "bill_votes_result_member" ADD CONSTRAINT "bill_votes_result_member_bill_votes_id_bill_votes_id_fk"
  FOREIGN KEY ("bill_votes_id") REFERENCES "bill_votes"("id") ON DELETE CASCADE;

-- bill_embeddings.bill_id
ALTER TABLE "bill_embeddings" DROP CONSTRAINT IF EXISTS "bill_embeddings_bill_id_bill_id_fk";
ALTER TABLE "bill_embeddings" ADD CONSTRAINT "bill_embeddings_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_enrichment.bill_id
ALTER TABLE "bill_enrichment" DROP CONSTRAINT IF EXISTS "bill_enrichment_bill_id_bill_id_fk";
ALTER TABLE "bill_enrichment" ADD CONSTRAINT "bill_enrichment_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_debates.bill_id
ALTER TABLE "bill_debates" DROP CONSTRAINT IF EXISTS "bill_debates_bill_id_bill_id_fk";
ALTER TABLE "bill_debates" ADD CONSTRAINT "bill_debates_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_debate_summary.bill_id
ALTER TABLE "bill_debate_summary" DROP CONSTRAINT IF EXISTS "bill_debate_summary_bill_id_bill_id_fk";
ALTER TABLE "bill_debate_summary" ADD CONSTRAINT "bill_debate_summary_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_cluster_assignments.cluster_id + bill_id
ALTER TABLE "bill_cluster_assignments" DROP CONSTRAINT IF EXISTS "bill_cluster_assignments_cluster_id_bill_clusters_id_fk";
ALTER TABLE "bill_cluster_assignments" ADD CONSTRAINT "bill_cluster_assignments_cluster_id_bill_clusters_id_fk"
  FOREIGN KEY ("cluster_id") REFERENCES "bill_clusters"("id") ON DELETE CASCADE;
ALTER TABLE "bill_cluster_assignments" DROP CONSTRAINT IF EXISTS "bill_cluster_assignments_bill_id_bill_id_fk";
ALTER TABLE "bill_cluster_assignments" ADD CONSTRAINT "bill_cluster_assignments_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- bill_cluster_label_names.cluster_id
ALTER TABLE "bill_cluster_label_names" DROP CONSTRAINT IF EXISTS "bill_cluster_label_names_cluster_id_bill_clusters_id_fk";
ALTER TABLE "bill_cluster_label_names" ADD CONSTRAINT "bill_cluster_label_names_cluster_id_bill_clusters_id_fk"
  FOREIGN KEY ("cluster_id") REFERENCES "bill_clusters"("id") ON DELETE CASCADE;

-- cluster_vector_results.cluster_id
ALTER TABLE "cluster_vector_results" DROP CONSTRAINT IF EXISTS "cluster_vector_results_cluster_id_bill_clusters_id_fk";
ALTER TABLE "cluster_vector_results" ADD CONSTRAINT "cluster_vector_results_cluster_id_bill_clusters_id_fk"
  FOREIGN KEY ("cluster_id") REFERENCES "bill_clusters"("id") ON DELETE CASCADE;

-- result_snapshot.cluster_id
ALTER TABLE "result_snapshot" DROP CONSTRAINT IF EXISTS "result_snapshot_cluster_id_bill_clusters_id_fk";
ALTER TABLE "result_snapshot" ADD CONSTRAINT "result_snapshot_cluster_id_bill_clusters_id_fk"
  FOREIGN KEY ("cluster_id") REFERENCES "bill_clusters"("id") ON DELETE CASCADE;

-- user_bill_answer.bill_id
ALTER TABLE "user_bill_answer" DROP CONSTRAINT IF EXISTS "user_bill_answer_bill_id_bill_id_fk";
ALTER TABLE "user_bill_answer" ADD CONSTRAINT "user_bill_answer_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- vote_delegation.bill_id
ALTER TABLE "vote_delegation" DROP CONSTRAINT IF EXISTS "vote_delegation_bill_id_bill_id_fk";
ALTER TABLE "vote_delegation" ADD CONSTRAINT "vote_delegation_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE CASCADE;

-- notification.bill_id (nullable → SET NULL)
ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "notification_bill_id_bill_id_fk";
ALTER TABLE "notification" ADD CONSTRAINT "notification_bill_id_bill_id_fk"
  FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE SET NULL;
