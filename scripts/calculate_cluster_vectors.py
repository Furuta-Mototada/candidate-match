#!/usr/bin/env python3
"""
Calculate cluster-specific member vectors using weighted PCA/SVD.

This script implements the following algorithm:
1. For each cluster k, build a member x bill voting matrix M_k
2. Apply importance weights to bills (passed=1.0, failed=0.6, important=1.5-2.0)
3. Apply weighted PCA/SVD to get latent vectors for each cluster
4. Output member positions in the latent space for each cluster
"""

import os
import json
import argparse
import numpy as np
from typing import Dict, List, Any, Optional, Tuple
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def get_db_connection():
    """Create database connection."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL is not set")
    return psycopg2.connect(database_url)


def load_legislation_scores(filepath: str) -> List[Dict]:
    """Load legislation scores from JSON file."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def load_bill_cluster_assignments(conn, cluster_id: int) -> Dict[int, int]:
    """Load bill to cluster label mapping for a specific clustering."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT bill_id, cluster_label
        FROM bill_cluster_assignments
        WHERE cluster_id = %s
    """,
        (cluster_id,),
    )

    assignments = {}
    for row in cursor.fetchall():
        assignments[row[0]] = row[1]
    cursor.close()
    return assignments


def load_bill_info(conn) -> Dict[int, Dict]:
    """Load bill information including passed status."""
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT b.id, b.passed, b.deliberation_completed, bd.title, bd.description
        FROM bill b
        LEFT JOIN bill_detail bd ON b.id = bd.bill_id
    """
    )

    bills = {}
    for row in cursor.fetchall():
        bills[row[0]] = {
            "id": row[0],
            "passed": row[1] or False,
            "deliberation_completed": row[2] or False,
            "title": row[3] or "",
            "description": row[4] or "",
        }
    cursor.close()
    return bills


def get_bill_weight(bill_info: Dict, title: str = "") -> float:
    """
    Calculate importance weight for a bill based on its status.

    Weights:
    - Passed bills (可決): 1.0
    - In progress (審議中): 0.8
    - Failed/discarded (否決・廃案): 0.6
    """
    passed = bill_info.get("passed", False)
    deliberation_completed = bill_info.get("deliberation_completed", False)

    if passed:
        # Bill has passed
        return 1.0
    elif not deliberation_completed:
        # Bill is still in progress (deliberation not completed)
        return 0.8
    else:
        # Bill failed or was discarded (deliberation completed but not passed)
        return 0.6


def normalize_score(
    score: float, min_score: float = -10, max_score: float = 12
) -> float:
    """Normalize score from original range to [-1, 1]."""
    # Map [min_score, max_score] to [-1, 1]
    return 2.0 * (score - min_score) / (max_score - min_score) - 1.0


def build_voting_matrix(
    legislation_scores: List[Dict], cluster_bills: List[int], bill_info: Dict[int, Dict]
) -> Tuple[np.ndarray, List[int], List[int], List[float], List[Dict]]:
    """
    Build member x bill voting matrix for a specific cluster.

    Returns:
        - voting_matrix: M x n_bills matrix of normalized scores
        - member_ids: List of member IDs
        - bill_ids: List of bill IDs in cluster
        - weights: List of weights for each bill
        - bill_details: List of bill detail dicts for representative bills
    """
    # Get all members who participated in any of the cluster bills
    member_scores_map: Dict[int, Dict[int, float]] = {}  # member_id -> bill_id -> score
    member_names: Dict[int, str] = {}

    for leg_score in legislation_scores:
        bill_id = leg_score["billId"]
        if bill_id not in cluster_bills:
            continue

        for member_score in leg_score["memberScores"]:
            member_id = member_score["memberId"]
            score = member_score["score"]

            if member_id not in member_scores_map:
                member_scores_map[member_id] = {}
            member_scores_map[member_id][bill_id] = normalize_score(score)
            member_names[member_id] = member_score["memberName"]

    # Build matrix
    member_ids = sorted(member_scores_map.keys())
    bill_ids = sorted(cluster_bills)

    if len(member_ids) == 0 or len(bill_ids) == 0:
        return np.array([]), [], [], [], []

    # Initialize matrix with NaN for missing values
    matrix = np.full((len(member_ids), len(bill_ids)), np.nan)

    for i, member_id in enumerate(member_ids):
        for j, bill_id in enumerate(bill_ids):
            if bill_id in member_scores_map.get(member_id, {}):
                matrix[i, j] = member_scores_map[member_id][bill_id]

    # Calculate weights for each bill
    weights = []
    bill_details = []
    for bill_id in bill_ids:
        info = bill_info.get(bill_id, {})
        title = info.get("title", "")
        weight = get_bill_weight(info, title)
        weights.append(weight)
        bill_details.append(
            {
                "billId": bill_id,
                "title": title,
                "passed": info.get("passed", False),
                "deliberationCompleted": info.get("deliberation_completed", False),
            }
        )

    return matrix, member_ids, bill_ids, weights, bill_details


def impute_missing_values(matrix: np.ndarray) -> np.ndarray:
    """
    Impute missing values in the voting matrix.
    Replace NaN with column mean (average vote for that bill).
    """
    result = matrix.copy()
    col_means = np.nanmean(result, axis=0)

    # Replace NaN in each column with its mean
    for j in range(result.shape[1]):
        mask = np.isnan(result[:, j])
        if np.any(mask):
            result[mask, j] = col_means[j] if not np.isnan(col_means[j]) else 0.0

    return result


def calculate_cluster_latent_vectors(
    voting_matrix: np.ndarray, weights: List[float], n_components: int = 3
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[float]]:
    """
    Calculate latent vectors using weighted PCA/SVD.

    Args:
        voting_matrix: M x n_bills matrix
        weights: List of weights for each bill
        n_components: Number of latent dimensions to keep

    Returns:
        - member_latent_vectors: M x n_components matrix (U * Sigma)
        - bill_loadings: n_bills x n_components matrix (V)
        - singular_values: n_components singular values
        - explained_variance_ratio: Proportion of variance explained by each component
    """
    if voting_matrix.size == 0:
        return np.array([]), np.array([]), np.array([]), []

    # Impute missing values
    matrix = impute_missing_values(voting_matrix)

    # Apply weights to bills (columns)
    weight_matrix = np.diag(weights)
    weighted_matrix = matrix @ weight_matrix

    # Center the matrix (subtract row means)
    row_means = np.mean(weighted_matrix, axis=1, keepdims=True)
    centered_matrix = weighted_matrix - row_means

    # Limit components to min of n_components and matrix dimensions
    max_components = min(
        n_components, centered_matrix.shape[0], centered_matrix.shape[1]
    )

    if max_components == 0:
        return np.array([]), np.array([]), np.array([]), []

    # Apply SVD
    U, S, Vt = np.linalg.svd(centered_matrix, full_matrices=False)

    # Keep top n_components
    U_k = U[:, :max_components]
    S_k = S[:max_components]
    V_k = Vt[:max_components, :].T  # n_bills x n_components

    # Member latent vectors: U * Sigma
    member_latent_vectors = U_k @ np.diag(S_k)

    # Calculate explained variance ratio
    total_variance = np.sum(S**2)
    explained_variance_ratio = (
        (S_k**2 / total_variance).tolist() if total_variance > 0 else []
    )

    return member_latent_vectors, V_k, S_k, explained_variance_ratio


def find_representative_bills(
    bill_loadings: np.ndarray,
    bill_ids: List[int],
    bill_details: List[Dict],
    top_n: int = 3,
) -> List[List[Dict]]:
    """
    Find representative bills for each latent dimension.

    Returns a list of lists, where each inner list contains the top bills
    for that dimension.
    """
    representative_bills = []

    if bill_loadings.size == 0:
        return representative_bills

    n_components = bill_loadings.shape[1]

    for dim in range(n_components):
        # Get absolute loadings for this dimension
        loadings = np.abs(bill_loadings[:, dim])

        # Get top N bills
        top_indices = np.argsort(loadings)[-top_n:][::-1]

        dim_representatives = []
        for idx in top_indices:
            dim_representatives.append(
                {
                    **bill_details[idx],
                    "loading": float(bill_loadings[idx, dim]),
                    "absLoading": float(loadings[idx]),
                }
            )

        representative_bills.append(dim_representatives)

    return representative_bills


def calculate_vectors_for_cluster(
    legislation_scores: List[Dict],
    cluster_bills: List[int],
    bill_info: Dict[int, Dict],
    member_ids_filter: Optional[List[int]] = None,
    n_components: int = 3,
) -> Dict[str, Any]:
    """
    Calculate latent vectors for a single cluster.

    Returns a dictionary containing:
    - member_vectors: Dict of member_id -> latent vector
    - bill_loadings: Loading matrix for bills
    - representative_bills: Representative bills for each dimension
    - explained_variance: Variance explained by each component
    """
    # Build voting matrix
    voting_matrix, member_ids, bill_ids, weights, bill_details = build_voting_matrix(
        legislation_scores, cluster_bills, bill_info
    )

    if voting_matrix.size == 0:
        return {
            "memberVectors": {},
            "billLoadings": [],
            "representativeBills": [],
            "explainedVariance": [],
            "dimensions": 0,
            "memberCount": 0,
            "billCount": 0,
        }

    # Calculate latent vectors
    member_latent, bill_loadings, singular_values, explained_variance = (
        calculate_cluster_latent_vectors(voting_matrix, weights, n_components)
    )

    if member_latent.size == 0:
        return {
            "memberVectors": {},
            "billLoadings": [],
            "representativeBills": [],
            "explainedVariance": [],
            "dimensions": 0,
            "memberCount": len(member_ids),
            "billCount": len(bill_ids),
        }

    # Build member vectors dict
    member_vectors = {}
    for i, member_id in enumerate(member_ids):
        member_vectors[member_id] = member_latent[i].tolist()

    # Find representative bills
    representative_bills = find_representative_bills(
        bill_loadings, bill_ids, bill_details, top_n=3
    )

    return {
        "memberVectors": member_vectors,
        "billLoadings": bill_loadings.tolist() if bill_loadings.size > 0 else [],
        "representativeBills": representative_bills,
        "explainedVariance": explained_variance,
        "dimensions": member_latent.shape[1] if member_latent.ndim > 1 else 0,
        "memberCount": len(member_ids),
        "billCount": len(bill_ids),
        "billIds": bill_ids,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Calculate cluster-specific member vectors"
    )
    parser.add_argument(
        "--cluster-id", type=int, required=True, help="Cluster ID to process"
    )
    parser.add_argument(
        "--cluster-label", type=int, help="Specific cluster label within the clustering"
    )
    parser.add_argument(
        "--n-components", type=int, default=3, help="Number of latent dimensions"
    )
    parser.add_argument("--output", type=str, help="Output JSON file path")
    parser.add_argument(
        "--legislation-scores",
        type=str,
        default="src/lib/data/legislation_scores.json",
        help="Path to legislation scores JSON",
    )
    args = parser.parse_args()

    print(f"Loading legislation scores from {args.legislation_scores}...")
    legislation_scores = load_legislation_scores(args.legislation_scores)
    print(f"Loaded {len(legislation_scores)} legislation records")

    print("Connecting to database...")
    conn = get_db_connection()

    print(f"Loading cluster assignments for cluster ID {args.cluster_id}...")
    assignments = load_bill_cluster_assignments(conn, args.cluster_id)
    print(f"Found {len(assignments)} bill assignments")

    print("Loading bill information...")
    bill_info = load_bill_info(conn)
    print(f"Loaded info for {len(bill_info)} bills")

    # Group bills by cluster label
    cluster_labels = set(assignments.values())

    # Filter to specific cluster label if provided
    if args.cluster_label is not None:
        cluster_labels = {args.cluster_label}

    print(f"Processing {len(cluster_labels)} cluster labels...")

    results = {}
    for label in sorted(cluster_labels):
        cluster_bills = [
            bill_id for bill_id, lbl in assignments.items() if lbl == label
        ]
        print(f"  Cluster {label}: {len(cluster_bills)} bills")

        result = calculate_vectors_for_cluster(
            legislation_scores, cluster_bills, bill_info, n_components=args.n_components
        )
        results[str(label)] = result

        print(
            f"    Members: {result['memberCount']}, Dimensions: {result['dimensions']}"
        )
        if result["explainedVariance"]:
            print(
                f"    Explained variance: {[f'{v:.2%}' for v in result['explainedVariance']]}"
            )

    conn.close()

    # Output results
    output_data = {
        "clusterId": args.cluster_id,
        "nComponents": args.n_components,
        "clusters": results,
    }

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        print(f"Results saved to {args.output}")
    else:
        print(json.dumps(output_data, ensure_ascii=False, indent=2))

    return output_data


if __name__ == "__main__":
    main()
