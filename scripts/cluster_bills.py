#!/usr/bin/env python3
"""
Perform clustering on bill embeddings.
Supports multiple clustering algorithms:
- K-Means
- HDBSCAN (density-based, automatically determines number of clusters)
"""

import os
import sys
import json
import numpy as np
import psycopg2
from psycopg2.extras import execute_values
from datetime import datetime
from typing import List, Dict, Tuple, Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

try:
    from sklearn.cluster import KMeans
    from sklearn.decomposition import PCA
    from sklearn.manifold import TSNE
except ImportError:
    print("scikit-learn not installed. Run: pip install scikit-learn")
    sys.exit(1)

try:
    import hdbscan
except ImportError:
    print("Note: hdbscan not installed. HDBSCAN clustering will not be available.")
    print("To install: pip install hdbscan")
    hdbscan = None


class BillClusterer:
    def __init__(self, database_url: str):
        """Initialize with database connection."""
        self.conn = psycopg2.connect(database_url)

    def load_embeddings(
        self, embedding_model: Optional[str] = None
    ) -> Tuple[List[int], np.ndarray, str]:
        """
        Load embeddings from database.

        Returns:
            Tuple of (bill_ids, embeddings_matrix, model_name)
        """
        cursor = self.conn.cursor()

        if embedding_model:
            cursor.execute(
                """
                SELECT bill_id, embedding, embedding_model
                FROM bill_embeddings
                WHERE embedding_model = %s
                ORDER BY bill_id
            """,
                (embedding_model,),
            )
        else:
            cursor.execute(
                """
                SELECT bill_id, embedding, embedding_model
                FROM bill_embeddings
                ORDER BY bill_id
            """
            )

        rows = cursor.fetchall()
        cursor.close()

        if not rows:
            raise ValueError("No embeddings found in database")

        bill_ids = []
        embeddings = []
        model_name = rows[0][2]

        for bill_id, embedding_json, _ in rows:
            bill_ids.append(bill_id)
            embeddings.append(json.loads(embedding_json))

        embeddings_matrix = np.array(embeddings)

        print(f"Loaded {len(bill_ids)} embeddings")
        print(f"Embedding dimension: {embeddings_matrix.shape[1]}")
        print(f"Model: {model_name}")

        return bill_ids, embeddings_matrix, model_name

    def cluster_kmeans(
        self, embeddings: np.ndarray, n_clusters: int = 8, random_state: int = 42
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Perform K-Means clustering.

        Returns:
            Tuple of (cluster_labels, distances_to_centers)
        """
        print(f"\nPerforming K-Means clustering with {n_clusters} clusters...")

        kmeans = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=10)
        cluster_labels = kmeans.fit_predict(embeddings)

        # Calculate distances to cluster centers
        distances = np.min(kmeans.transform(embeddings), axis=1)

        # Print cluster distribution
        unique, counts = np.unique(cluster_labels, return_counts=True)
        print("\nCluster distribution:")
        for label, count in zip(unique, counts):
            print(f"  Cluster {label}: {count} bills")

        return cluster_labels, distances

    def cluster_hdbscan(
        self, embeddings: np.ndarray, min_cluster_size: int = 5, min_samples: int = 3
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Perform HDBSCAN clustering (density-based).
        Automatically determines the number of clusters.

        Returns:
            Tuple of (cluster_labels, probabilities)
        """
        if hdbscan is None:
            raise ImportError("hdbscan package is not installed")

        print(
            f"\nPerforming HDBSCAN clustering (min_cluster_size={min_cluster_size}, min_samples={min_samples})..."
        )

        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size, min_samples=min_samples
        )
        cluster_labels = clusterer.fit_predict(embeddings)
        probabilities = clusterer.probabilities_

        # Print cluster distribution
        unique, counts = np.unique(cluster_labels, return_counts=True)
        print("\nCluster distribution:")
        for label, count in zip(unique, counts):
            if label == -1:
                print(f"  Noise (unclustered): {count} bills")
            else:
                print(f"  Cluster {label}: {count} bills")

        return cluster_labels, probabilities

    def reduce_dimensions_pca(
        self, embeddings: np.ndarray, n_components: int = 2
    ) -> np.ndarray:
        """Reduce dimensionality using PCA for visualization."""
        print(f"\nReducing dimensions to {n_components}D using PCA...")
        pca = PCA(n_components=n_components)
        reduced = pca.fit_transform(embeddings)
        print(f"Explained variance ratio: {pca.explained_variance_ratio_}")
        return reduced

    def reduce_dimensions_tsne(
        self, embeddings: np.ndarray, n_components: int = 2, perplexity: int = 30
    ) -> np.ndarray:
        """Reduce dimensionality using t-SNE for visualization."""
        print(f"\nReducing dimensions to {n_components}D using t-SNE...")
        tsne = TSNE(n_components=n_components, perplexity=perplexity, random_state=42)
        reduced = tsne.fit_transform(embeddings)
        return reduced

    def store_clustering_result(
        self,
        name: str,
        algorithm: str,
        parameters: Dict,
        embedding_model: str,
        bill_ids: List[int],
        cluster_labels: np.ndarray,
        distances: np.ndarray,
    ) -> int:
        """
        Store clustering result in database.

        Returns:
            cluster_id of the stored clustering result
        """
        cursor = self.conn.cursor()

        try:
            # Insert clustering metadata
            cursor.execute(
                """
                INSERT INTO bill_clusters (name, algorithm, parameters, embedding_model, created_at)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """,
                (
                    name,
                    algorithm,
                    json.dumps(parameters),
                    embedding_model,
                    datetime.now(),
                ),
            )

            cluster_id = cursor.fetchone()[0]

            # Insert cluster assignments
            assignments = []
            for bill_id, label, dist in zip(bill_ids, cluster_labels, distances):
                assignments.append((cluster_id, bill_id, int(label), float(dist)))

            execute_values(
                cursor,
                """
                INSERT INTO bill_cluster_assignments (cluster_id, bill_id, cluster_label, distance)
                VALUES %s
            """,
                assignments,
            )

            self.conn.commit()
            print(f"\n✓ Clustering result stored with ID: {cluster_id}")

            return cluster_id

        except Exception as e:
            self.conn.rollback()
            print(f"\nError storing clustering result: {e}")
            raise
        finally:
            cursor.close()

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()


def main():
    # Get database URL from environment
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("Error: DATABASE_URL environment variable not set")
        sys.exit(1)

    # Parse command line arguments
    if len(sys.argv) < 3:
        print("Usage: python cluster_bills.py <algorithm> <name> [params...]")
        print("\nAlgorithms:")
        print("  kmeans <name> <n_clusters>")
        print("  hdbscan <name> <min_cluster_size> [min_samples]")
        print("\nExamples:")
        print("  python cluster_bills.py kmeans 'Policy Topics - 10 clusters' 10")
        print("  python cluster_bills.py hdbscan 'Auto-clustered Topics' 5 3")
        sys.exit(1)

    algorithm = sys.argv[1].lower()
    name = sys.argv[2]

    # Initialize clusterer
    clusterer = BillClusterer(database_url)

    try:
        # Load embeddings
        bill_ids, embeddings, embedding_model = clusterer.load_embeddings()

        # Perform clustering based on algorithm
        if algorithm == "kmeans":
            if len(sys.argv) < 4:
                print("Error: K-Means requires n_clusters parameter")
                sys.exit(1)

            n_clusters = int(sys.argv[3])
            parameters = {"n_clusters": n_clusters, "random_state": 42}

            cluster_labels, distances = clusterer.cluster_kmeans(embeddings, n_clusters)

        elif algorithm == "hdbscan":
            min_cluster_size = int(sys.argv[3]) if len(sys.argv) > 3 else 5
            min_samples = int(sys.argv[4]) if len(sys.argv) > 4 else 3

            parameters = {
                "min_cluster_size": min_cluster_size,
                "min_samples": min_samples,
            }

            cluster_labels, probabilities = clusterer.cluster_hdbscan(
                embeddings, min_cluster_size, min_samples
            )
            distances = 1.0 - probabilities  # Use inverse probability as "distance"

        else:
            print(f"Error: Unknown algorithm '{algorithm}'")
            print("Supported algorithms: kmeans, hdbscan")
            sys.exit(1)

        # Store result
        cluster_id = clusterer.store_clustering_result(
            name,
            algorithm,
            parameters,
            embedding_model,
            bill_ids,
            cluster_labels,
            distances,
        )

        print(f"\n=== Clustering Complete ===")
        print(f"Cluster ID: {cluster_id}")
        print(f"Name: {name}")
        print(f"Algorithm: {algorithm}")
        print(f"Parameters: {json.dumps(parameters)}")

    finally:
        clusterer.close()


if __name__ == "__main__":
    main()
