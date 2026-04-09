CREATE TABLE IF NOT EXISTS "evaluation_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_user"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_evaluation_run_user_created" ON "evaluation_run" ("user_id", "created_at");
