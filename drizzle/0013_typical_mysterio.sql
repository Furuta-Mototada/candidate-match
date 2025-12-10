CREATE TYPE "public"."bill_result" AS ENUM('可決', '否決', '撤回', '未了');--> statement-breakpoint
CREATE TABLE "bill_session" (
	"bill_id" integer NOT NULL,
	"session_number" integer NOT NULL,
	"is_submission_session" boolean DEFAULT false NOT NULL,
	CONSTRAINT "bill_session_bill_id_session_number_pk" PRIMARY KEY("bill_id","session_number")
);
--> statement-breakpoint
ALTER TABLE "bill_detail" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "bill_detail" CASCADE;--> statement-breakpoint
ALTER TABLE "bill" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "bill" ADD COLUMN "result" "bill_result";--> statement-breakpoint
ALTER TABLE "bill" ADD COLUMN "result_date" date;--> statement-breakpoint
ALTER TABLE "bill" ADD COLUMN "committee_name" text;--> statement-breakpoint
ALTER TABLE "bill_votes" ADD COLUMN "session" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "group" ADD COLUMN "chamber" "chamber";--> statement-breakpoint
ALTER TABLE "bill_session" ADD CONSTRAINT "bill_session_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_session" ADD CONSTRAINT "bill_session_session_number_congress_session_session_number_fk" FOREIGN KEY ("session_number") REFERENCES "public"."congress_session"("session_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_submission_session_congress_session_session_number_fk" FOREIGN KEY ("submission_session") REFERENCES "public"."congress_session"("session_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_debates" ADD CONSTRAINT "bill_debates_session_congress_session_session_number_fk" FOREIGN KEY ("session") REFERENCES "public"."congress_session"("session_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes" ADD CONSTRAINT "bill_votes_session_congress_session_session_number_fk" FOREIGN KEY ("session") REFERENCES "public"."congress_session"("session_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_bill" ADD CONSTRAINT "committee_bill_session_congress_session_session_number_fk" FOREIGN KEY ("session") REFERENCES "public"."congress_session"("session_number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" DROP COLUMN "deliberation_completed";--> statement-breakpoint
ALTER TABLE "bill" DROP COLUMN "passed";