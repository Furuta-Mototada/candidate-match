CREATE TYPE "public"."delegation_status" AS ENUM('pending', 'accepted', 'rejected', 'retracted', 'voted');--> statement-breakpoint
CREATE TABLE "vote_delegation" (
	"id" serial PRIMARY KEY NOT NULL,
	"delegator_id" text NOT NULL,
	"delegate_id" text NOT NULL,
	"bill_id" integer NOT NULL,
	"status" "delegation_status" DEFAULT 'pending' NOT NULL,
	"voted_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vote_delegation_delegator_id_bill_id_unique" UNIQUE("delegator_id","bill_id")
);
--> statement-breakpoint
ALTER TABLE "vote_delegation" ADD CONSTRAINT "vote_delegation_delegator_id_auth_user_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_delegation" ADD CONSTRAINT "vote_delegation_delegate_id_auth_user_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_delegation" ADD CONSTRAINT "vote_delegation_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;