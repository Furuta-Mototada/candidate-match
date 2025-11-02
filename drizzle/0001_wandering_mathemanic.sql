CREATE TYPE "public"."bill_type" AS ENUM('衆法', '参法', '閣法');--> statement-breakpoint
CREATE TYPE "public"."chamber" AS ENUM('参議院', '衆議院');--> statement-breakpoint
CREATE TYPE "public"."voting_method" AS ENUM('異議なし採決', '起立投票', '記名投票', '押しボタン');--> statement-breakpoint
ALTER TABLE "bill" ALTER COLUMN "type" SET DATA TYPE "public"."bill_type" USING "type"::"public"."bill_type";--> statement-breakpoint
ALTER TABLE "bill_votes" ALTER COLUMN "chamber" SET DATA TYPE "public"."chamber" USING "chamber"::"public"."chamber";--> statement-breakpoint
ALTER TABLE "bill_votes" ALTER COLUMN "voting_method" SET DATA TYPE "public"."voting_method" USING "voting_method"::"public"."voting_method";--> statement-breakpoint
ALTER TABLE "committee" ALTER COLUMN "chamber" SET DATA TYPE "public"."chamber" USING "chamber"::"public"."chamber";--> statement-breakpoint
ALTER TABLE "member_party" ALTER COLUMN "start_date" DROP NOT NULL;