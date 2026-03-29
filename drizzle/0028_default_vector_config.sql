-- Add is_default column to cluster_vector_results to allow setting a default config for /match
ALTER TABLE "cluster_vector_results" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;