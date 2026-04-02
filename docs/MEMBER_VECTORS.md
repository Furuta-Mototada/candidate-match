# Member Vectors (議員ベクトル分析)

## Overview

The Member Vectors system generates vector representations of each parliamentary member based on their voting patterns within specific bill clusters. Using **cluster-based latent vector analysis**, you can visualize member positions for each bill cluster.

### Key Features

- **Cluster-specific Analysis**: Analyze voting patterns per bill cluster
- **Latent Dimension Extraction**: Extract meaningful dimensions using weighted PCA/SVD
- **Representative Bills Display**: Show bills that represent each latent dimension
- **2D Scatter Plot Visualization**: Interactive canvas plotting members in latent space
- **Similar Member Search**: Find similar members using cosine similarity
- **Member Comparison**: Compare latent vectors of two members side-by-side
- **Saved Vector Results**: Pre-calculate and store vectors for faster matching
- **Default Vector Configuration**: Mark a vector group as the default for the `/match` endpoint
- **Admin-only Calculation**: Only admin users can run vector analysis

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

### Usage (Admin Panel)

Only admin users can run vector analysis. The admin panel provides:

1. **Enter Analysis Name**: Provide a name (auto-generated default: `{clusterName} {n}D - {date}`)
2. **Select Clustering Result**: Choose a bill clustering configuration
3. **Set Number of Dimensions**: Select 1-5 latent dimensions
4. **Preview Target Clusters**: Shows cluster labels with bill counts
5. **Calculate & Save**: Click "ベクトル分析を実行" — calculates vectors for **all cluster labels** and auto-saves to database

Results are always saved immediately with the provided name.

### Saved Vectorizations Panel

Saved vector groups are displayed grouped by `name|clusterId`. Each group shows:
- Name, cluster, dimensions, cluster count, total bills, creation date
- **デフォルト (Default) badge**: Indicates the default vector group for `/match`
- **Star button** (admin): Set or clear a vector group as the default

Clicking a saved vectorization loads all its cluster data for viewing.

### Interpreting Results

- **Cluster Label Switcher**: Navigate between cluster labels (0, 1, ...) with LLM-generated names
- **Stats Summary**: Member count, bill count, dimension count, total explained variance
- **Explained Variance**: How much of the voting pattern variance each dimension explains
- **Representative Bills**: Bills that define the "meaning" of each dimension, color-coded by result status
- **Positive/Negative Values**: Indicates support/opposition tendency for representative bills

### 2D Scatter Plot Visualization

An interactive canvas plots members in 2D latent space:

- **Axis Selectors**: Choose which latent dimensions to display on X and Y axes
- **Member Points**: Color-coded by state:
  - **Indigo (`#6366f1`)**: Regular members
  - **Amber (`#f59e0b`)**: Similar members (top 10 by cosine similarity)
  - **Green (`#22c55e`)**: Selected member
  - **Pink (`#ec4899`)**: Hovered member
- **Interactions**: Hover for tooltip (name + coordinates), click to select and show similar members
- **Grid**: Includes zero lines (dashed), tick labels, and axis labels showing dimension + explained variance
- **High-DPI Support**: Renders at `devicePixelRatio` for crisp display

### Member List & Modal

- **Searchable grid** of member cards with name and latent values (positive=green, negative=red)
- **Sortable**: By name or by dimension (0, 1, 2)
- **Member Modal**:
  - Latent vector values with dimension labels (includes representative bill title)
  - **Similar Members Search**: Top 20 by cosine similarity
  - **Comparison**: Side-by-side table vs. another member with similarity score


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
  is_default BOOLEAN NOT NULL DEFAULT false,  -- Default config for /match
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Default Vector Configuration

A vector group (identified by `name` + `clusterId`) can be marked as the default for the `/match` endpoint. When set, all rows in `cluster_vector_results` matching that name and cluster ID have `is_default = true`. Only one group can be the default at a time — setting a new default clears all previous defaults.

Admins can set/clear the default from:
- The member-vectors page (star button on saved vectorizations)
- The match API (`set-default` / `clear-default` actions)

### Loading Saved Vectors

Saved vectors are used by the matching API to skip calculation:
```json
{
  "action": "start",
  "savedVectorId": 1
}
```

This skips the 10-30 second calculation time.

### Vector Group Key on Snapshots

When a matching result is saved as a snapshot, the `result_snapshot` table stores a `vector_group_key` column (format: `"vectorName|clusterId"`). This allows the system to reconstruct full visualization data (user vectors, member vectors, explained variance) when reviewing saved results later.


## API Reference

### GET /api/cluster-vectors

Retrieve cluster labels and saved results for a specific clustering, or list all saved results.

**Parameters**:
- `clusterId` (required unless `all=true`): Clustering ID
- `saved` (optional): If `"true"`, return saved vector results
- `all` (optional): If `"true"` with `saved=true`, return all saved results across all clusters

**Response (default — cluster labels)**:
```json
{
  "clusterId": 1,
  "clusterName": "2024 Regular Session Bills",
  "algorithm": "kmeans",
  "parameters": "...",
  "clusterLabels": [
    { "label": 0, "billCount": 45, "name": "環境・エネルギー", "description": "..." },
    { "label": 1, "billCount": 32, "name": "地方財政・交付税", "description": "..." }
  ],
  "savedResults": [
    {
      "id": 5, "clusterLabel": 0, "nComponents": 3, "name": "2024 Env 3D",
      "dimensions": 3, "memberCount": 389, "billCount": 45, "createdAt": "..."
    }
  ]
}
```

**Response (`saved=true&all=true`)**:
```json
{
  "success": true,
  "savedResults": [
    {
      "id": 5, "clusterId": 1, "clusterLabel": 0, "nComponents": 3,
      "name": "2024 Env 3D", "dimensions": 3, "memberCount": 389,
      "billCount": 45, "isDefault": true, "createdAt": "..."
    }
  ]
}
```

### POST /api/cluster-vectors

Calculate cluster-specific latent vectors. Admin permission required.

Executes `scripts/calculate_cluster_vectors.py` via `child_process` and enriches results with member names from the database. If `saveImmediately` is true, all calculated clusters are saved automatically.

**Request**:
```json
{
  "clusterId": 1,
  "clusterLabel": 0,
  "nComponents": 3,
  "saveImmediately": true,
  "saveName": "2024 Environment Bills - 3D"
}
```

**Response**:
```json
{
  "success": true,
  "clusterId": 1,
  "clusterName": "2024 Regular Session Bills",
  "nComponents": 3,
  "savedCount": 5,
  "savedName": "2024 Environment Bills - 3D",
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
          { "billId": 101, "title": "Example Bill", "result": "可決", "loading": 0.89, "absLoading": 0.89 }
        ]
      ],
      "explainedVariance": [0.35, 0.22, 0.15],
      "dimensions": 3,
      "memberCount": 389,
      "billCount": 45,
      "billIds": [101, 102, 103]
    }
  }
}
```

### PUT /api/cluster-vectors

Manually save a single cluster's calculated vectors to the database.

**Request**:
```json
{
  "clusterId": 1,
  "clusterLabel": 0,
  "nComponents": 3,
  "name": "2024 Environment - 3D",
  "clusterData": {
    "memberVectors": { ... },
    "memberNames": { ... },
    "billLoadings": [ ... ],
    "billIds": [ ... ],
    "explainedVariance": [ ... ],
    "dimensions": 3,
    "memberCount": 389,
    "billCount": 45,
    "representativeBills": [ ... ]
  }
}
```

**Response**:
```json
{ "success": true, "id": 5, "message": "Cluster vectors saved successfully" }
```

### GET /api/cluster-vectors/[id]

Get a specific saved cluster vector result by ID (includes full JSON data).

**Response**:
```json
{ "success": true, "data": { ... } }
```

### DELETE /api/cluster-vectors/[id]

Delete a specific saved cluster vector result by ID.

**Response**:
```json
{ "success": true, "message": "Saved vector deleted successfully" }
```

### POST /api/match (vector-related actions)

The match API includes vector configuration actions:

| Action | Purpose | Admin Required |
|--------|---------|:-:|
| `start` + `savedVectorId` | Load pre-calculated vectors | No |
| `resume` + `savedVectorId` | Resume session with saved vectors | No |
| `set-default` | Mark a vector group as default for matching | Yes |
| `clear-default` | Remove the default vector group | Yes |

**set-default request**:
```json
{
  "action": "set-default",
  "name": "vector group name",
  "configClusterId": 1
}
```


## Command Line Usage

```bash
# Calculate vectors for a cluster
python scripts/calculate_cluster_vectors.py --cluster-id 1 --n-components 3

# Calculate for a specific cluster label
python scripts/calculate_cluster_vectors.py --cluster-id 1 --cluster-label 0 --n-components 3

# Output to file
python scripts/calculate_cluster_vectors.py --cluster-id 1 --output result.json

# Use custom legislation scores path
python scripts/calculate_cluster_vectors.py --cluster-id 1 --legislation-scores path/to/scores.json
```

**CLI Arguments**:
| Argument | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `--cluster-id` | Yes | — | Cluster ID to process |
| `--cluster-label` | No | all labels | Specific cluster label within the clustering |
| `--n-components` | No | 3 | Number of latent dimensions (1-5) |
| `--output` | No | stdout | Output JSON file path |
| `--legislation-scores` | No | `static/data/legislation_scores.json` | Path to legislation scores JSON |


## Files

| File | Description |
|------|-------------|
| `/scripts/calculate_cluster_vectors.py` | Cluster vector calculation script (Python) |
| `/src/routes/api/cluster-vectors/+server.ts` | API endpoint (GET, POST, PUT) |
| `/src/routes/api/cluster-vectors/[id]/+server.ts` | Single vector result endpoint (GET, DELETE) |
| `/src/routes/member-vectors/+page.svelte` | UI component |
| `/src/routes/member-vectors/+page.server.ts` | Server-side data loading (loads bill clusters) |
| `/src/lib/server/party-matching.ts` | Party matching integration (uses `vectorGroupKey`) |
| `/docs/MEMBER_VECTORS.md` | This documentation |


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


## Performance

| Metric | Value |
|--------|-------|
| Calculation Time | 10-30 seconds (depends on cluster size) |
| Max Dimensions | 5 (configurable) |
| Similarity Search | Instant (client-side) |


