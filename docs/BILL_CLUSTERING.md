# Bill Clustering Analysis

This document explains how to use the bill (legislative proposal) clustering analysis system.

## Overview

This system analyzes bills submitted to the National Diet using the following approach:

1. **PDF Acquisition**: Download bill PDFs from the House of Councillors website
2. **Text Extraction**: Extract bill text, title, and description from PDFs
3. **Vectorization**: Convert bills to high-dimensional vectors using Japanese-compatible embedding models
4. **Clustering**: Group similar bills using K-Means or HDBSCAN
5. **Cluster Naming**: Generate human-readable names for each cluster using LLM (auto-triggered after clustering if OPENAI_API_KEY is set)
6. **Cluster Vector Calculation**: Calculate member latent vectors per cluster using weighted PCA/SVD on voting matrices
7. **Visualization**: Explore clusters through an interactive Web UI with enrichment data, debate records, and vote results

## Usage

### Step 1: Generate Bill Embeddings

First, generate embedding vectors for bills in the database:

```bash
# Process all bills without embeddings
pnpm embeddings:generate

# Or, process with a limit (e.g., first 10 bills only)
python scripts/generate_bill_embeddings.py 10
```

This script:
1. Retrieves bills without embeddings
2. Scrapes the actual PDF URL from the bill's detail page on sangiin.go.jp
3. Downloads the PDF and extracts text
4. Combines title, description, and full text (limited to first 5000 characters) to create a document
5. Converts to 768-dimensional vector using multilingual Sentence-BERT model (`paraphrase-multilingual-mpnet-base-v2`)
6. Saves the embedding, PDF URL, and extracted text to database using upsert strategy

**Note**: The embedding model (~1GB) will be downloaded on first run.

### Step 2: Run Clustering

#### K-Means Clustering (Specify number of clusters)

```bash
pnpm cluster:bills kmeans "Policy Topics - 10 Clusters" 10
```

Parameters:
- `kmeans`: Algorithm name
- `"Policy Topics - 10 Clusters"`: Name for this clustering result
- `10`: Number of clusters

#### HDBSCAN Clustering (Automatically determine cluster count)

```bash
python scripts/cluster_bills.py hdbscan "Auto Clustering" 5 3
```

Parameters:
- `hdbscan`: Algorithm name
- `"Auto Clustering"`: Name for this clustering result
- `5`: Minimum cluster size (min_cluster_size)
- `3`: Minimum samples (min_samples)

HDBSCAN is density-based clustering that detects outliers as noise (cluster -1).

**Note**: HDBSCAN works best with lower-dimensional data. For 768D embeddings, it often classifies everything as noise. K-Means is recommended for this use case.

**Note**: After clustering completes, `name_clusters.py` is automatically invoked to generate LLM cluster names if `OPENAI_API_KEY` is set in the environment.

### Step 3: Generate Cluster Names (Optional)

Use LLM to generate human-readable names for each cluster:

```bash
pnpm cluster:name <cluster_id>

# Force regenerate all names (even if they exist)
pnpm cluster:name <cluster_id> --force
```

This script:
1. Reads bill titles for each cluster label
2. Uses GPT-5.1 to analyze common themes and generate a descriptive name (with JSON response format)
3. Saves names to `bill_cluster_label_names` table using upsert logic

Example output:
- Cluster 0: "環境・エネルギー" - 地球温暖化対策や再生可能エネルギーに関する法案群
- Cluster 1: "地方財政・交付税" - 地方自治体の財政基盤強化と交付税制度の改正に関する法案群

### Step 4: Calculate Cluster Vectors (Optional)

Calculate member latent vectors per cluster using weighted PCA/SVD on voting matrices. This can be done via the API or CLI:

```bash
# Process all cluster labels for a given clustering
python scripts/calculate_cluster_vectors.py --cluster-id <cluster_id>

# Process a specific cluster label
python scripts/calculate_cluster_vectors.py --cluster-id <cluster_id> --cluster-label <label>

# Specify number of PCA dimensions (default: 3)
python scripts/calculate_cluster_vectors.py --cluster-id <cluster_id> --n-components 2
```

This script:
1. Loads legislation scores and cluster bill assignments
2. Builds a per-cluster voting matrix (members × bills)
3. Applies bill importance weighting:
   - 可決 (passed): 1.0
   - 否決 (rejected): 0.6
   - 撤回 (withdrawn): 0.3
   - 未了 (expired): 0.2
   - null (deliberating): 0.8
4. Performs weighted SVD to produce member latent vectors and bill loadings
5. Identifies representative bills per dimension
6. Outputs JSON (or saves to `cluster_vector_results` table via the API)

### Step 5: Visualize in Web UI

Start the development server:

```bash
pnpm dev
```

Access `http://localhost:5173/bill-clustering` in your browser.

#### Web UI Features

1. **New Clustering Generation** (Admin only):
   - Select algorithm (K-Means or HDBSCAN)
   - Adjust parameters
   - Execute directly from browser

2. **View Clustering Results**:
   - Select existing clustering results from cards (shows name, algorithm, creation date, parameters, bill count)
   - Browse bills grouped by cluster with LLM-generated cluster names and descriptions
   - Color-coded cluster display with 10-color palette
   - 2D PCA scatter plot visualization with interactive zoom (50%–500%) and pan controls
   - Click or hover bills in scatter plot to view details
   - Legend showing cluster labels with bill counts

3. **View Bill Details** (right sidebar panel):
   - Type, session, number, title, description
   - Assigned committees (grouped by session)
   - PDF link to view the actual bill document
   - Distance from cluster center
   - Bill status badges: 可決 (green), 否決 (red), 撤回 (gray), 未了 (yellow), 審議中 (blue)

4. **Bill Enrichment Data** (when available):
   - Short summary (概要) and detailed explanation (詳細説明)
   - Impact tags with gradient badges
   - Key points in Who/What/When format
   - Pros and cons separated lists
   - Example scenario (real-world application)
   - Debate records (limited to 5 most recent)
   - Vote results by political group (approve/reject)

## Architecture

### Data Flow

```
Bill Data (DB)
    ↓
PDF Acquisition & Text Extraction
    ↓
Embedding Generation (Sentence-BERT)
    ↓
Clustering (K-Means / HDBSCAN)
    ↓
LLM Cluster Naming (auto-triggered if OPENAI_API_KEY is set)
    ↓
2D Visualization (PCA → x,y stored in DB + cached JSON)
    ↓
Cluster Vector Calculation (Weighted SVD on voting matrices)
    ↓
Save Results (DB)
    ↓
Web UI Visualization (scatter plot, enrichment, debates, votes)
```

### Embedding Model

Uses `paraphrase-multilingual-mpnet-base-v2` by default:
- Supports 50+ languages (including Japanese)
- Outputs 768-dimensional vectors
- Semantically similar text produces nearby vectors

### Clustering Algorithms

#### K-Means
- **Pros**: Fast, pre-specify number of clusters
- **Cons**: Assumes spherical clusters, sensitive to outliers
- **Use case**: When you know the number of clusters

#### HDBSCAN
- **Pros**: Automatically determines cluster count, detects outliers, handles arbitrary cluster shapes
- **Cons**: Requires parameter tuning, may not work well with high-dimensional sparse data
- **Use case**: Exploratory analysis

## Visualization System

2D visualization coordinates are stored in the `bill_cluster_assignments` table (`x`, `y` columns) and also cached as JSON files at `static/data/bill_embeddings_2d_cluster_{id}.json`. The API uses a three-tier fallback:

1. **Cached JSON file** (fastest) — `static/data/bill_embeddings_2d_cluster_{id}.json`
2. **Database coordinates** — `x`, `y` columns in `bill_cluster_assignments`
3. **Generate on demand** — Runs `scripts/visualize_embeddings_2d.py` to compute PCA reduction and store results

This allows switching between clustering results without losing visualizations. The visualization uses PCA (Principal Component Analysis) to reduce 768-dimensional embeddings to 2D for plotting in an interactive scatter plot with zoom and pan controls.

## Database Schema

### Tables

```sql
-- Bill embeddings with extracted text
CREATE TABLE bill_embeddings (
  bill_id INTEGER PRIMARY KEY REFERENCES bill(id),
  pdf_url TEXT,                -- URL to the PDF document
  text_content TEXT,           -- Extracted PDF text
  embedding TEXT NOT NULL,     -- JSON serialized vector (array of floats)
  embedding_model TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Clustering results
CREATE TABLE bill_clusters (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  parameters TEXT NOT NULL,     -- JSON string of clustering parameters
  embedding_model TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cluster assignments (composite primary key)
CREATE TABLE bill_cluster_assignments (
  cluster_id INTEGER NOT NULL REFERENCES bill_clusters(id),
  bill_id INTEGER NOT NULL REFERENCES bill(id),
  cluster_label INTEGER NOT NULL,
  distance TEXT,               -- Distance to cluster center (string)
  x REAL,                      -- 2D visualization x coordinate (PCA)
  y REAL,                      -- 2D visualization y coordinate (PCA)
  PRIMARY KEY (cluster_id, bill_id)
);

-- LLM-generated cluster names
CREATE TABLE bill_cluster_label_names (
  cluster_id INTEGER NOT NULL REFERENCES bill_clusters(id),
  cluster_label INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  generated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY(cluster_id, cluster_label)
);

-- Pre-calculated member vectors for matching
CREATE TABLE cluster_vector_results (
  id SERIAL PRIMARY KEY,
  cluster_id INTEGER NOT NULL REFERENCES bill_clusters(id),
  cluster_label INTEGER NOT NULL,
  n_components INTEGER NOT NULL,        -- Number of PCA dimensions
  name TEXT NOT NULL,                   -- User-provided name for this calculation
  member_vectors TEXT NOT NULL,         -- JSON: Record<string, number[]>
  member_names TEXT NOT NULL,           -- JSON: Record<string, string>
  bill_loadings TEXT NOT NULL,          -- JSON: number[][]
  bill_ids TEXT NOT NULL,               -- JSON: number[]
  explained_variance TEXT NOT NULL,     -- JSON: number[]
  dimensions INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  bill_count INTEGER NOT NULL,
  representative_bills TEXT,            -- JSON: RepresentativeBill[][]
  is_default BOOLEAN DEFAULT false,     -- Whether this is the default config for /match
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Files

| Script | npm Command | Description |
|--------|-------------|-------------|
| `generate_bill_embeddings.py` | `pnpm embeddings:generate` | Generate embeddings from PDF text |
| `cluster_bills.py` | `pnpm cluster:bills` | Run clustering algorithm (auto-invokes naming) |
| `name_clusters.py` | `pnpm cluster:name` | Generate LLM names for clusters |
| `calculate_cluster_vectors.py` | - (via API) | Calculate member latent vectors per cluster using weighted SVD |
| `visualize_embeddings_2d.py` | - | Generate 2D PCA projection (stores in DB + JSON) |

## Troubleshooting

### PDF Acquisition Error

```
Error downloading PDF from https://...
```

**Cause**: PDF doesn't exist, URL pattern is incorrect
**Solution**: 
1. Verify URL in browser
2. Check scraping logic in `scrape_pdf_url()`
3. May be temporary network error (retry)

### Slow Embedding Generation

**Cause**: Running model on CPU
**Solution**:
1. Use GPU (automatically uses GPU in CUDA-enabled environment)
2. Use lighter model (e.g., MiniLM series)
3. Implement batch processing (process multiple bills simultaneously)

### Out of Memory Error

**Cause**: Processing too many bills at once
**Solution**:
```bash
# Process in smaller batches
python scripts/generate_bill_embeddings.py 50
```

### Database Connection Error

**Cause**: `DATABASE_URL` environment variable not set
**Solution**:
```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
```

Or set in `.env` file.

## API Reference

### GET /api/bill-embeddings

Get all bill embeddings, or 2D visualization data for a specific cluster.

**Query Parameters**:
- `clusterId` (optional): If provided, returns 2D visualization data using three-tier fallback (cached JSON → DB coordinates → generate on-demand)

**Response** (without `clusterId`):
```json
{
  "embeddings": [
    {
      "billId": 1,
      "embedding": [0.123, -0.456, ...],
      "embeddingModel": "paraphrase-multilingual-mpnet-base-v2",
      "billType": "閣法",
      "submissionSession": 198,
      "billNumber": 1,
      "title": "..."
    }
  ]
}
```

**Response** (with `clusterId`):
```json
[
  {
    "billId": 1,
    "type": "閣法",
    "session": 198,
    "number": 1,
    "title": "...",
    "x": -0.091,
    "y": 0.130,
    "cluster": 8
  }
]
```

### GET /api/bill-clusters

Get list of clustering results.

**Response**:
```json
{
  "clusters": [
    {
      "id": 1,
      "name": "Policy Topics - 10 Clusters",
      "algorithm": "kmeans",
      "parameters": "{\"n_clusters\": 10}",
      "embeddingModel": "paraphrase-multilingual-mpnet-base-v2",
      "createdAt": "2024-01-01",
      "billCount": 100
    }
  ]
}
```

### GET /api/bill-clusters?id={clusterId}

Get details of a specific clustering result.

**Response**:
```json
{
  "cluster": { ... },
  "billsByCluster": {
    "0": [
      {
        "billId": 1,
        "clusterLabel": 0,
        "distance": "0.123",
        "billType": "閣法",
        "submissionSession": 198,
        "billNumber": 1,
        "title": "...",
        "description": "...",
        "result": "可決",
        "pdfUrl": "...",
        "committees": [
          { "name": "...", "chamber": "...", "session": 198 }
        ]
      }
    ]
  },
  "labelNames": {
    "0": { "name": "環境・エネルギー", "description": "..." }
  },
  "totalBills": 100
}
```

### POST /api/generate-clustering

Generate new clustering (requires admin role).

**Request**:
```json
{
  "algorithm": "kmeans",
  "name": "Test Clustering",
  "n_clusters": 8
}
```

**Response**:
```json
{
  "success": true,
  "clusterId": 5,
  "output": "...",
  "message": "Clustering generated successfully"
}
```

### POST /api/cluster-vectors

Calculate cluster-specific member vectors (requires admin role).

**Request**:
```json
{
  "clusterId": 1,
  "clusterLabel": 0,
  "nComponents": 3,
  "saveImmediately": false,
  "saveName": "My Vectors"
}
```

**Response**:
```json
{
  "success": true,
  "clusterId": 1,
  "clusterName": "Policy Topics",
  "nComponents": 3,
  "clusters": {
    "0": {
      "memberVectors": { "member_id": [0.1, -0.2, 0.3] },
      "memberNames": { "member_id": "山田 太郎" },
      "billLoadings": [[...]],
      "representativeBills": [[{ "billId": 1, "title": "...", "result": "可決", "loading": 0.5, "absLoading": 0.5 }]],
      "explainedVariance": [0.4, 0.3, 0.2],
      "dimensions": 3,
      "memberCount": 50,
      "billCount": 20,
      "billIds": [1, 2, 3]
    }
  }
}
```

### PUT /api/cluster-vectors

Save calculated cluster vectors.

**Request**:
```json
{
  "clusterId": 1,
  "clusterLabel": 0,
  "nComponents": 3,
  "name": "My Saved Vectors",
  "clusterData": { ... }
}
```

### GET /api/cluster-vectors

Get cluster labels and saved vector results.

**Query Parameters**:
- `clusterId` (required unless `all=true`): Cluster to query
- `saved` (optional): `"true"` to get saved results
- `all` (optional): `"true"` to get all saved results across all clusters

### GET /api/cluster-vectors/[id]

Get a specific saved vector result by ID.

### DELETE /api/cluster-vectors/[id]

Delete a saved vector result by ID.

### GET /api/bill-enrichment?billId={billId}

Get enriched bill content (summaries, key points, impact tags, pros/cons, debates, vote results).

**Response**:
```json
{
  "billId": 1,
  "title": "...",
  "description": "...",
  "passed": true,
  "summaryShort": "...",
  "summaryDetailed": "...",
  "keyPoints": [{ "who": "...", "what": "...", "when": "..." }],
  "impactTags": ["環境", "エネルギー"],
  "prosAndCons": { "pros": ["..."], "cons": ["..."] },
  "exampleScenario": "...",
  "enrichmentStatus": "completed",
  "pdfUrl": "...",
  "debates": [...],
  "debateCount": 5,
  "voteResults": [{ "groupName": "自由民主党", "approved": true }]
}
```


