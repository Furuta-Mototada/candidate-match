# Member Vectors (議員ベクトル分析)

## Overview

The Member Vectors system generates vector representations of each parliamentary member based on their voting patterns within specific bill clusters. Using **cluster-based latent vector analysis**, you can visualize member positions for each bill cluster.

### Key Features

- **Cluster-specific Analysis**: Analyze voting patterns per bill cluster
- **Latent Dimension Extraction**: Extract meaningful dimensions using weighted PCA/SVD
- **Representative Bills Display**: Show bills that represent each latent dimension
- **Similar Member Search**: Find similar members using cosine similarity
- **Member Comparison**: Compare latent vectors of two members side-by-side

## Access

Page URL: `/member-vectors` (http://localhost:5173/member-vectors)

---

## Cluster-based Latent Vector Analysis

### Algorithm Overview

Uses bill clustering results to calculate member latent vectors for each cluster.

#### 1. Data Preparation

- Retrieve target bills from bill clustering results
- Get member voting scores for each bill (from legislation_scores.json)

#### 2. Voting Matrix Construction

For cluster $k$, construct an $M \times n_k$ voting matrix:

$$
V_k[i,j] = \text{normalize}(\text{score}_{i,j})
$$

- $M$: Number of members
- $n_k$: Number of bills in cluster $k$
- Scores are normalized to $[-1, 1]$

#### 3. Bill Importance Weighting

Apply importance weights based on bill status:

| Bill Status | Weight |
|-------------|--------|
| Passed (可決) | 1.0 |
| In Progress (審議中) | 0.8 |
| Failed/Discarded (否決・廃案) | 0.6 |

Weighted matrix:
$$
\tilde{V}_k = V_k \cdot \text{diag}(w_1, w_2, \ldots, w_{n_k})
$$

#### 4. Singular Value Decomposition (SVD)

Apply SVD to the centered matrix:

$$
\tilde{V}_k - \bar{V}_k = U \Sigma V^T
$$

Extract top $d_k$ components:
- **Member Latent Vectors**: $U_k \cdot \Sigma_k$ ($M \times d_k$)
- **Bill Loading Matrix**: $V_k$ ($n_k \times d_k$)

#### 5. Identify Representative Bills

For each dimension, extract bills with the highest absolute loadings:

$$
\text{representative}_d = \underset{j}{\arg\max} |V_k[j, d]|
$$

### Usage

1. **Select Clustering Result**: Choose a clustering result from the bill clustering page
2. **Select Cluster Label**: Choose a specific cluster or "All" clusters
3. **Set Number of Dimensions**: Select 1-5 latent dimensions
4. **Calculate**: Click "潜在ベクトルを計算" (Calculate Latent Vectors)

### Interpreting Results

- **Explained Variance**: How much of the voting pattern variance each dimension explains
- **Representative Bills**: Bills that define the "meaning" of each dimension
- **Positive/Negative Values**: Indicates support/opposition tendency for representative bills

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
    { "label": 0, "billCount": 45 },
    { "label": 1, "billCount": 32 }
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
  "nComponents": 3
}
```

**Response**:
```json
{
  "success": true,
  "clusterId": 1,
  "clusterName": "2024 Regular Session Bills",
  "nComponents": 3,
  "clusters": {
    "0": {
      "memberVectors": {
        "123": [0.45, -0.23, 0.12],
        "456": [-0.31, 0.67, 0.05]
      },
      "memberNames": {
        "123": "Yamada Taro",
        "456": "Suzuki Hanako"
      },
      "representativeBills": [
        [
          { "billId": 101, "title": "Example Bill", "loading": 0.89, "passed": true }
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

### Calculation Script

`/scripts/calculate_cluster_vectors.py`

**Dependencies**:
- `numpy`
- `scikit-learn`
- `psycopg2`
- `python-dotenv`

**Command Line Arguments**:
```bash
python scripts/calculate_cluster_vectors.py \
  --cluster-id 1 \
  --cluster-label 0 \
  --n-components 3 \
  --output result.json
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
