-- Drop redundant columns from result_snapshot.
-- total_answered can be computed from cluster_results_json.
-- n_components is never displayed and is not needed once results are stored.

ALTER TABLE "result_snapshot" DROP COLUMN "n_components";
ALTER TABLE "result_snapshot" DROP COLUMN "total_answered";
