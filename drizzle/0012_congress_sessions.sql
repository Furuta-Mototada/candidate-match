CREATE TYPE "public"."session_type" AS ENUM('常会', '臨時会', '特別会');--> statement-breakpoint
CREATE TABLE "congress_session" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_number" integer NOT NULL,
	"session_type" "session_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	CONSTRAINT "congress_session_session_number_unique" UNIQUE("session_number")
);
