#!/usr/bin/env python3
"""
Reduce bill embeddings to 2D using PCA for visualization.
"""

import os
import sys
import json
import numpy as np
import psycopg2
from datetime import datetime
from typing import List, Dict, Tuple
from dotenv import load_dotenv

load_dotenv()

try:
    from sklearn.decomposition import PCA
except ImportError:
    print("scikit-learn not installed. Run: pip install scikit-learn")
    sys.exit(1)


def reduce_embeddings_to_2d(database_url: str, cluster_id: int = None):
    """Load embeddings and reduce to 2D using PCA."""
    conn = psycopg2.connect(database_url)
    cursor = conn.cursor()

    # Get all embeddings with bill details
    cursor.execute(
        """
        SELECT 
            be.bill_id,
            be.embedding,
            b.type,
            b.submission_session,
            b.number,
            b.title
        FROM bill_embeddings be
        JOIN bill b ON be.bill_id = b.id
        ORDER BY be.bill_id
    """
    )

    rows = cursor.fetchall()

    if len(rows) < 2:
        print("Need at least 2 bills with embeddings for visualization")
        cursor.close()
        conn.close()
        return

    # Parse embeddings
    bill_ids = []
    embeddings = []
    bills_info = []

    for row in rows:
        bill_ids.append(row[0])
        embeddings.append(json.loads(row[1]))
        bills_info.append(
            {
                "billId": row[0],
                "type": row[2],
                "session": row[3],
                "number": row[4],
                "title": row[5] or "Untitled",
            }
        )

    embeddings_matrix = np.array(embeddings)

    print(
        f"Reducing {len(bill_ids)} embeddings from {embeddings_matrix.shape[1]}D to 2D using PCA..."
    )

    # Apply PCA
    pca = PCA(n_components=2)
    reduced = pca.fit_transform(embeddings_matrix)

    print(f"Explained variance: {pca.explained_variance_ratio_}")
    print(f"Total variance explained: {sum(pca.explained_variance_ratio_):.2%}")

    # Get cluster assignments
    cluster_assignments = {}
    if cluster_id is not None:
        # Use specified cluster
        cursor.execute(
            """
            SELECT bill_id, cluster_label
            FROM bill_cluster_assignments
            WHERE cluster_id = %s
        """,
            (cluster_id,),
        )

        for bill_id, label in cursor.fetchall():
            cluster_assignments[bill_id] = int(label)

        print(f"Loaded cluster assignments from cluster {cluster_id}")
    else:
        # Use latest cluster if no cluster specified
        cursor.execute(
            """
            SELECT DISTINCT cluster_id FROM bill_cluster_assignments
            ORDER BY cluster_id DESC LIMIT 1
        """
        )
        latest_cluster = cursor.fetchone()

        if latest_cluster:
            cluster_id = latest_cluster[0]
            cursor.execute(
                """
                SELECT bill_id, cluster_label
                FROM bill_cluster_assignments
                WHERE cluster_id = %s
            """,
                (cluster_id,),
            )

            for bill_id, label in cursor.fetchall():
                cluster_assignments[bill_id] = int(label)

            print(f"Loaded cluster assignments from cluster {cluster_id}")

    # Create visualization data and prepare database updates
    viz_data = []
    db_updates = []
    for i, bill_info in enumerate(bills_info):
        x_val = float(reduced[i, 0])
        y_val = float(reduced[i, 1])
        cluster_label = cluster_assignments.get(bill_info["billId"], -1)

        viz_data.append(
            {
                **bill_info,
                "x": x_val,
                "y": y_val,
                "cluster": cluster_label,
            }
        )

        # Only add to updates if we have a valid cluster assignment
        if cluster_id is not None and bill_info["billId"] in cluster_assignments:
            db_updates.append((x_val, y_val, cluster_id, bill_info["billId"]))

    # Update x, y coordinates in database
    if db_updates:
        cursor.executemany(
            """
            UPDATE bill_cluster_assignments 
            SET x = %s, y = %s
            WHERE cluster_id = %s AND bill_id = %s
            """,
            db_updates,
        )
        conn.commit()
        print(
            f"\n✓ Updated {len(db_updates)} bill_cluster_assignments with x, y coordinates"
        )

    # Save to cluster-specific file if cluster_id is provided, otherwise use default
    if cluster_id is not None:
        output_file = f"static/data/bill_embeddings_2d_cluster_{cluster_id}.json"
    else:
        output_file = "static/data/bill_embeddings_2d.json"

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(viz_data, f, ensure_ascii=False, indent=2)

    print(f"✓ Saved 2D visualization data to {output_file}")
    print(f"  {len(viz_data)} bills")
    if cluster_id is not None:
        print(f"  Cluster ID: {cluster_id}")

    cursor.close()
    conn.close()


def main():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable not set")
        sys.exit(1)

    # Check if cluster ID is provided as argument
    cluster_id = None
    if len(sys.argv) > 1:
        try:
            cluster_id = int(sys.argv[1])
            print(f"Using cluster ID: {cluster_id}")
        except ValueError:
            print("Error: Cluster ID must be an integer")
            sys.exit(1)

    reduce_embeddings_to_2d(database_url, cluster_id)


if __name__ == "__main__":
    main()
