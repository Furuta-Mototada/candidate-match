ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."delegation_status";--> statement-breakpoint
CREATE TYPE "public"."delegation_status" AS ENUM('pending', 'rejected', 'redelegated', 'voted');--> statement-breakpoint
ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."delegation_status";--> statement-breakpoint
ALTER TABLE "vote_delegation" ALTER COLUMN "status" SET DATA TYPE "public"."delegation_status" USING "status"::"public"."delegation_status";--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."notification_type";--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('friend_request_received', 'friend_request_accepted', 'friend_request_rejected', 'delegation_received', 'delegation_rejected', 'delegation_redelegated', 'delegation_voted', 'delegation_retracted', 'welcome');--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "type" SET DATA TYPE "public"."notification_type" USING "type"::"public"."notification_type";