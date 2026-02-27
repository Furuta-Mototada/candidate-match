CREATE TABLE "user_bill_answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bill_id" integer NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_bill_answer_user_id_bill_id_unique" UNIQUE("user_id","bill_id")
);
--> statement-breakpoint
DROP TABLE "session_answer" CASCADE;--> statement-breakpoint
ALTER TABLE "user_bill_answer" ADD CONSTRAINT "user_bill_answer_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bill_answer" ADD CONSTRAINT "user_bill_answer_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_matching_session" DROP COLUMN "saved_vector_key";