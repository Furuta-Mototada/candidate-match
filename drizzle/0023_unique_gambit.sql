ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."delegation_status";--> statement-breakpoint
CREATE TYPE "public"."delegation_status" AS ENUM('pending', 'accepted', 'rejected', 'redelegated', 'voted');--> statement-breakpoint
ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."delegation_status";--> statement-breakpoint
ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DATA TYPE "public"."delegation_status" USING "status"::"public"."delegation_status";