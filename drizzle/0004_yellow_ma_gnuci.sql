ALTER TABLE "cabinet" ADD COLUMN "member_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "cabinet" ADD CONSTRAINT "cabinet_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cabinet" DROP COLUMN "name";