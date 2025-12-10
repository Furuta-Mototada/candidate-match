CREATE TYPE "public"."enrichment_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "bill_debate_summary" (
	"bill_id" integer PRIMARY KEY NOT NULL,
	"pro_arguments_summary" text,
	"con_arguments_summary" text,
	"key_questions" text,
	"government_explanations" text,
	"debate_count" integer DEFAULT 0 NOT NULL,
	"status" "enrichment_status" DEFAULT 'pending' NOT NULL,
	"llm_model" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_debates" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"meeting_id" text NOT NULL,
	"speech_id" text NOT NULL,
	"session" integer NOT NULL,
	"house" text NOT NULL,
	"meeting_name" text NOT NULL,
	"issue_number" text,
	"meeting_date" date,
	"speaker_name" text NOT NULL,
	"speaker_group" text,
	"speaker_position" text,
	"speaker_role" text,
	"speech_order" integer,
	"speech_content" text NOT NULL,
	"speech_url" text,
	"speech_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bill_debates_speech_id_unique" UNIQUE("speech_id")
);
--> statement-breakpoint
CREATE TABLE "bill_enrichment" (
	"bill_id" integer PRIMARY KEY NOT NULL,
	"summary_short" text,
	"summary_detailed" text,
	"key_points" text,
	"impact_tags" text,
	"pros_and_cons" text,
	"example_scenario" text,
	"status" "enrichment_status" DEFAULT 'pending' NOT NULL,
	"llm_model" text,
	"source_text_hash" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_debate_summary" ADD CONSTRAINT "bill_debate_summary_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_debates" ADD CONSTRAINT "bill_debates_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_enrichment" ADD CONSTRAINT "bill_enrichment_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;