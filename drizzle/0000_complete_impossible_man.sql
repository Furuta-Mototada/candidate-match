CREATE TABLE "bill" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"submission_session" integer NOT NULL,
	"number" integer NOT NULL,
	"submission_date" date,
	"deliberation_completed" boolean DEFAULT false,
	"passed" boolean DEFAULT false,
	CONSTRAINT "bill_type_submission_session_number_unique" UNIQUE("type","submission_session","number")
);
--> statement-breakpoint
CREATE TABLE "bill_detail" (
	"bill_id" integer PRIMARY KEY NOT NULL,
	"title" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "bill_sponsor_groups" (
	"bill_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	CONSTRAINT "bill_sponsor_groups_bill_id_group_id_pk" PRIMARY KEY("bill_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "bill_sponsors" (
	"bill_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	CONSTRAINT "bill_sponsors_bill_id_member_id_pk" PRIMARY KEY("bill_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "bill_supporters" (
	"bill_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	CONSTRAINT "bill_supporters_bill_id_member_id_pk" PRIMARY KEY("bill_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "bill_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"bill_id" integer NOT NULL,
	"chamber" text NOT NULL,
	"voting_method" text NOT NULL,
	"voting_date" date
);
--> statement-breakpoint
CREATE TABLE "bill_votes_result_group" (
	"bill_votes_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"approved" boolean NOT NULL,
	CONSTRAINT "bill_votes_result_group_bill_votes_id_group_id_pk" PRIMARY KEY("bill_votes_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "bill_votes_result_member" (
	"bill_votes_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"approved" boolean NOT NULL,
	CONSTRAINT "bill_votes_result_member_bill_votes_id_member_id_pk" PRIMARY KEY("bill_votes_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "committee" (
	"id" serial PRIMARY KEY NOT NULL,
	"chamber" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_bill" (
	"id" serial PRIMARY KEY NOT NULL,
	"committee_id" integer NOT NULL,
	"bill_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "member_party" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_detail" ADD CONSTRAINT "bill_detail_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsor_groups" ADD CONSTRAINT "bill_sponsor_groups_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsor_groups" ADD CONSTRAINT "bill_sponsor_groups_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_sponsors" ADD CONSTRAINT "bill_sponsors_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_supporters" ADD CONSTRAINT "bill_supporters_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_supporters" ADD CONSTRAINT "bill_supporters_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes" ADD CONSTRAINT "bill_votes_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes_result_group" ADD CONSTRAINT "bill_votes_result_group_bill_votes_id_bill_votes_id_fk" FOREIGN KEY ("bill_votes_id") REFERENCES "public"."bill_votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes_result_group" ADD CONSTRAINT "bill_votes_result_group_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes_result_member" ADD CONSTRAINT "bill_votes_result_member_bill_votes_id_bill_votes_id_fk" FOREIGN KEY ("bill_votes_id") REFERENCES "public"."bill_votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_votes_result_member" ADD CONSTRAINT "bill_votes_result_member_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_bill" ADD CONSTRAINT "committee_bill_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_bill" ADD CONSTRAINT "committee_bill_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group" ADD CONSTRAINT "member_group_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group" ADD CONSTRAINT "member_group_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_party" ADD CONSTRAINT "member_party_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_party" ADD CONSTRAINT "member_party_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;