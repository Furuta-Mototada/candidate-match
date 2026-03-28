CREATE TYPE "public"."notification_type" AS ENUM('friend_request_received', 'friend_request_accepted', 'friend_request_rejected', 'delegation_received', 'delegation_accepted', 'delegation_rejected', 'delegation_redelegated', 'delegation_voted', 'delegation_retracted', 'welcome');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "notification_type" NOT NULL,
	"actor_id" text,
	"resource_id" integer,
	"bill_id" integer,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_user_read" ON "notification" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "idx_notification_user_created" ON "notification" USING btree ("user_id","created_at");