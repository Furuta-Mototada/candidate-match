# Member Vectors (議員ベクトル分析)

## Overview

The Member Vectors system generates vector representations of each parliamentary member based on their voting patterns within specific bill clusters. Using **cluster-based latent vector analysis**, you can visualize member positions for each bill cluster.

### Key Features

- **Cluster-specific Analysis**: Analyze voting patterns per bill cluster
- **Latent Dimension Extraction**: Extract meaningful dimensions using weighted PCA/SVD
- **Representative Bills Display**: Show bills that represent each latent dimension
- **Similar Member Search**: Find similar members using cosine similarity
- **Member Comparison**: Compare latent vectors of two members side-by-side
- **Saved Vector Results**: Pre-calculate and store vectors for faster matching

## Access

Page URL: `/member-vectors` (http://localhost:5173/member-vectors)

---

## Cluster-based Latent Vector Analysis

### Algorithm Overview

Uses bill clustering results to calculate member latent vectors for each cluster. The algorithm is implemented in `scripts/calculate_cluster_vectors.py`.

#### 1. Data Preparation

- Retrieve target bills from bill clustering results (`bill_cluster_assignments`)
- Get member voting scores for each bill (from `legislation_scores.json`)
- Filter to only bills in the selected cluster

#### 2. Voting Matrix Construction

For cluster $k$, construct an $M \times n_k$ voting matrix:

$$
V_k[i,j] = \text{normalize}(\text{score}_{i,j})
$$

- $M$: Number of members
- $n_k$: Number of bills in cluster $k$
- Scores are normalized from original range to $[-1, 1]$

Missing values (members who didn't vote on a bill) are imputed with column mean (average vote for that bill).

#### 3. Bill Importance Weighting

Apply importance weights based on bill result status:

| Bill Result | Weight | Rationale |
|-------------|--------|-----------|
| 可決 (Passed) | 1.0 | Most reliable voting data |
| null (In Progress) | 0.8 | Ongoing deliberation |
| 未了 (Expired) | 0.2 | Low significance |
| 否決 (Rejected) | 0.6 | Still meaningful opposition |
| 撤回 (Withdrawn) | 0.3 | Low significance |

Weighted matrix:
$$
\tilde{V}_k = V_k \cdot \text{diag}(w_1, w_2, \ldots, w_{n_k})
$$

#### 4. Singular Value Decomposition (SVD)

Apply SVD to the centered, weighted matrix:

$$
\tilde{V}_k - \bar{V}_k = U \Sigma V^T
$$

Extract top $d_k$ components (typically 3):
- **Member Latent Vectors**: $U_k \cdot \Sigma_k$ ($M \times d_k$)
- **Bill Loading Matrix**: $V_k$ ($n_k \times d_k$)
- **Explained Variance**: Proportion of variance captured by each dimension

#### 5. Identify Representative Bills

For each dimension, extract bills with the highest absolute loadings:

$$
\text{representative}_d = \underset{j}{\arg\max} |V_k[j, d]|
$$

These bills define the "meaning" of each dimension.

### Usage

1. **Select Clustering Result**: Choose a clustering result from the bill clustering page
2. **Select Cluster Label**: Choose a specific cluster or "All" clusters
3. **Set Number of Dimensions**: Select 1-5 latent dimensions
4. **Calculate**: Click "潜在ベクトルを計算" (Calculate Latent Vectors)
5. **Save**: Optionally save results to database for faster matching

### Saved Vector Results

Pre-calculated vectors can be saved to the `cluster_vector_results` table for:
- Faster matching session startup (no need to recalculate)
- Consistent results across sessions
- Named vector sets for organization

### Interpreting Results

- **Explained Variance**: How much of the voting pattern variance each dimension explains
- **Representative Bills**: Bills that define the "meaning" of each dimension
- **Positive/Negative Values**: Indicates support/opposition tendency for representative bills
- **Cluster Names**: LLM-generated names help interpret cluster themes

---

## Saving Vector Results

### Database Storage

```sql
CREATE TABLE cluster_vector_results (
  id SERIAL PRIMARY KEY,
  cluster_id INTEGER REFERENCES bill_clusters(id),
  cluster_label INTEGER NOT NULL,
  n_components INTEGER NOT NULL,       -- Number of PCA dimensions
  name TEXT NOT NULL,                  -- User-provided name
  member_vectors TEXT NOT NULL,        -- JSON: {memberId: [v1, v2, v3]}
  member_names TEXT NOT NULL,          -- JSON: {memberId: name}
  bill_loadings TEXT NOT NULL,         -- JSON: [[b1d1, b1d2], [b2d1, b2d2]]
  bill_ids TEXT NOT NULL,              -- JSON: [id1, id2, ...]
  explained_variance TEXT NOT NULL,    -- JSON: [0.35, 0.22, 0.15]
  dimensions INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  bill_count INTEGER NOT NULL,
  representative_bills TEXT,           -- JSON: RepresentativeBill[][] (optional)
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Loading Saved Vectors

Saved vectors are used by the matching API:
```json
{
  "action": "start",
  "savedVectorId": 1
}
```

This skips the 10-30 second calculation time.

---

## API Reference

### GET /api/cluster-vectors

Retrieve cluster labels list.

**Parameters**:
- `clusterId` (required): Clustering ID

**Response**:
```json
{
  "clusterId": 1,
  "clusterName": "2024 Regular Session Bills",
  "algorithm": "kmeans",
  "clusterLabels": [
    { "label": 0, "billCount": 45, "name": "環境・エネルギー" },
    { "label": 1, "billCount": 32, "name": "地方財政・交付税" }
  ]
}
```

### POST /api/cluster-vectors

Calculate cluster-specific latent vectors.

**Request**:
```json
{
  "clusterId": 1,
  "clusterLabel": 0,
  "nComponents": 3,
  "save": true,
  "name": "2024 Environment Bills - 3D"
}
```

**Response**:
```json
{
  "success": true,
  "clusterId": 1,
  "clusterName": "2024 Regular Session Bills",
  "nComponents": 3,
  "savedId": 5,
  "clusters": {
    "0": {
      "memberVectors": {
        "123": [0.45, -0.23, 0.12],
        "456": [-0.31, 0.67, 0.05]
      },
      "memberNames": {
        "123": "山田太郎",
        "456": "鈴木花子"
      },
      "representativeBills": [
        [
          { "billId": 101, "title": "Example Bill", "loading": 0.89, "result": "可決" }
        ]
      ],
      "explainedVariance": [0.35, 0.22, 0.15],
      "dimensions": 3,
      "memberCount": 389,
      "billCount": 45
    }
  }
}
```

---

## Command Line Usage

```bash
# Calculate vectors for a cluster
python scripts/calculate_cluster_vectors.py --cluster-id 1 --n-components 3

# Calculate for a specific cluster label
python scripts/calculate_cluster_vectors.py --cluster-id 1 --cluster-label 0 --n-components 3

# Output to file
python scripts/calculate_cluster_vectors.py --cluster-id 1 --output result.json
```

---

## File Structure

| File | Description |
|------|-------------|
| `/scripts/calculate_cluster_vectors.py` | Cluster vector calculation script (Python) |
| `/src/routes/api/cluster-vectors/+server.ts` | API endpoint |
| `/src/routes/member-vectors/+page.svelte` | UI component |
| `/src/routes/member-vectors/+page.server.ts` | Server-side data loading |
| `/docs/MEMBER_VECTORS.md` | This documentation |

---

## Technical Specifications

### Dependencies (Python)

```txt
numpy
scikit-learn
psycopg2
python-dotenv
```

### Similarity Calculation

Uses cosine similarity:

$$
\text{similarity}(A, B) = \frac{A \cdot B}{\|A\| \times \|B\|}
$$

Results range from 0 (unrelated) to 1 (identical).

---

## Performance

| Metric | Value |
|--------|-------|
| Calculation Time | 10-30 seconds (depends on cluster size) |
| Max Dimensions | 5 (configurable) |
| Similarity Search | Instant (client-side) |

---

## Related Documentation

- [Bill Clustering](/docs/BILL_CLUSTERING.md)
- [Legislation Scores](/docs/LEGISLATION_SCORES.md)

---

## Future Enhancements

- 2D/3D visualization (t-SNE/UMAP)
- Time-series analysis (changes across sessions)
- Party/faction aggregation
- Data export functionality
