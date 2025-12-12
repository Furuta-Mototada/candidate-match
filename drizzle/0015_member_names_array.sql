-- Convert name column to names array
ALTER TABLE "member" ADD COLUMN "names" text[];--> statement-breakpoint
UPDATE "member" SET "names" = ARRAY["name"];--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "names" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "name_reading" text;