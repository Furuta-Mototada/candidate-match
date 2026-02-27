ALTER TABLE "saved_matching_session" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_cluster_result" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "saved_matching_session" CASCADE;--> statement-breakpoint
DROP TABLE "session_cluster_result" CASCADE;--> statement-breakpoint
ALTER TABLE "result_snapshot" DROP CONSTRAINT "result_snapshot_session_id_snapshot_number_unique";--> statement-breakpoint
ALTER TABLE "result_snapshot" DROP CONSTRAINT "result_snapshot_session_id_saved_matching_session_id_fk";
--> statement-breakpoint
ALTER TABLE "result_snapshot" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD COLUMN "cluster_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD COLUMN "n_components" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD CONSTRAINT "result_snapshot_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_snapshot" ADD CONSTRAINT "result_snapshot_cluster_id_bill_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."bill_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_snapshot" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "result_snapshot" DROP COLUMN "snapshot_number";--> statement-breakpoint
DROP TYPE "public"."session_status";