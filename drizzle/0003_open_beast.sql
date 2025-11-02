CREATE TABLE "cabinet" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
ALTER TABLE "member_group" ALTER COLUMN "start_date" DROP NOT NULL;