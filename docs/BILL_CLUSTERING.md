# Bill Clustering Analysis

This document explains how to use the bill (legislative proposal) clustering analysis system.

## Overview

This system analyzes bills submitted to the National Diet using the following approach:

1. **PDF Acquisition**: Download bill PDFs from the House of Councillors website
2. **Text Extraction**: Extract bill text, title, and description from PDFs
3. **Vectorization**: Convert bills to high-dimensional vectors using Japanese-compatible embedding models
4. **Clustering**: Group similar bills using K-Means or HDBSCAN
5. **Cluster Naming**: Generate human-readable names for each cluster using LLM
6. **Visualization**: Explore clusters through an interactive Web UI

## Setup

### 1. Install Python Packages

```bash
pip install -r requirements.txt
```

Required packages:
- `sentence-transformers`: Multilingual sentence embedding models
- `PyPDF2`: PDF parsing
- `scikit-learn`: Clustering algorithms
- `hdbscan`: Density-based clustering (optional)
- `psycopg2-binary`: PostgreSQL client
- `beautifulsoup4`: HTML parsing for scraping PDF URLs
- `openai`: For LLM-based cluster naming

### 2. Update Database Schema

```bash
pnpm db:generate
pnpm db:push
```

This creates the following tables:
- `bill_embeddings`: Bill embedding vectors and extracted text
- `bill_clusters`: Clustering result metadata
- `bill_cluster_assignments`: Each bill's cluster assignment
- `bill_cluster_label_names`: Human-readable names for cluster labels

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
4. Combines title, description, and full text to create a document
5. Converts to 768-dimensional vector using multilingual Sentence-BERT model (`paraphrase-multilingual-mpnet-base-v2`)
6. Saves both the embedding and extracted text to database

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

### Step 3: Generate Cluster Names (Optional)

Use LLM to generate human-readable names for each cluster:

```bash
pnpm cluster:name <cluster_id>

# Force regenerate all names (even if they exist)
pnpm cluster:name <cluster_id> --force
```

This script:
1. Reads bill titles for each cluster label
2. Uses GPT-4o to analyze common themes and generate a descriptive name
3. Saves names to `bill_cluster_label_names` table

Example output:
- Cluster 0: "環境・エネルギー" - 地球温暖化対策や再生可能エネルギーに関する法案群
- Cluster 1: "地方財政・交付税" - 地方自治体の財政基盤強化と交付税制度の改正に関する法案群

### Step 4: Visualize in Web UI

Start the development server:

```bash
pnpm dev
```

Access `http://localhost:5173/bill-clustering` in your browser.

#### Web UI Features

1. **New Clustering Generation**:
   - Select algorithm (K-Means or HDBSCAN)
   - Adjust parameters
   - Execute directly from browser

2. **View Clustering Results**:
   - Select existing clustering results
   - Browse bills within each cluster
   - View LLM-generated cluster names and descriptions
   - Color-coded cluster display
   - 2D PCA scatter plot visualization (automatically generated per cluster)

3. **View Bill Details**:
   - Click a bill (from list or graph) to show detail panel
   - Type, session, number, title, description
   - Assigned committees
   - PDF link to view the actual bill document
   - Distance from cluster center
   - Link to enriched bill content (if available)

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
LLM Cluster Naming (Optional)
    ↓
Save Results (DB)
    ↓
Web UI Visualization (2D PCA projection)
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

Each clustering analysis generates its own 2D visualization file stored as `bill_embeddings_2d_cluster_{id}.json`. This allows you to:
- Switch between different clustering results without losing visualizations
- Cache visualization data for faster loading
- Generate visualizations on-demand when first viewing a cluster

The visualization uses PCA (Principal Component Analysis) to reduce 768-dimensional embeddings to 2D for plotting in an interactive scatter plot.

## Database Schema

### Tables

```sql
-- Bill embeddings with extracted text
CREATE TABLE bill_embeddings (
  bill_id INTEGER PRIMARY KEY REFERENCES bill(id),
  embedding JSONB NOT NULL,
  embedding_model TEXT NOT NULL,
  text_content TEXT,           -- Extracted PDF text
  created_at TIMESTAMP DEFAULT NOW()
);

-- Clustering results
CREATE TABLE bill_clusters (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  parameters JSONB,
  embedding_model TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cluster assignments
CREATE TABLE bill_cluster_assignments (
  id SERIAL PRIMARY KEY,
  cluster_id INTEGER REFERENCES bill_clusters(id),
  bill_id INTEGER REFERENCES bill(id),
  cluster_label INTEGER NOT NULL,
  distance REAL,
  UNIQUE(cluster_id, bill_id)
);

-- LLM-generated cluster names
CREATE TABLE bill_cluster_label_names (
  cluster_id INTEGER REFERENCES bill_clusters(id),
  cluster_label INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  generated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY(cluster_id, cluster_label)
);
```

## Customization

### Using a Different Embedding Model

Edit `scripts/generate_bill_embeddings.py`:

```python
# Example: Japanese-specialized model
generator = BillEmbeddingGenerator(
    database_url,
    model_name='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
)
```

Available models: https://www.sbert.net/docs/pretrained_models.html

### Adjusting PDF URL Pattern

If the bill PDF URL structure changes, modify the `scrape_pdf_url()` method.

### Optimizing Clustering Parameters

- **K-Means**: Experiment with different `n_clusters` values (recommended: 5-15)
- **HDBSCAN**: 
  - `min_cluster_size`: Smaller = finer clusters, larger = bigger clusters (recommended: 5-20)
  - `min_samples`: Smaller = less noise, larger = more noise (recommended: 1-5)

### Customizing Cluster Names

The LLM prompt in `name_clusters.py` can be modified to generate different styles of names:
- Current style: Short names (≤8 characters) with descriptions
- Can be adjusted for longer names, different languages, or specific terminology

## Scripts Reference

| Script | npm Command | Description |
|--------|-------------|-------------|
| `generate_bill_embeddings.py` | `pnpm embeddings:generate` | Generate embeddings from PDF text |
| `cluster_bills.py` | `pnpm cluster:bills` | Run clustering algorithm |
| `name_clusters.py` | `pnpm cluster:name` | Generate LLM names for clusters |
| `visualize_embeddings_2d.py` | - | Generate 2D PCA projection |

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

## API Endpoints

### GET /api/bill-embeddings

Get all bill embeddings.

**Query Parameters**:
- `clusterId` (optional): Generate and return 2D visualization data for specific cluster

**Response**:
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
      "createdAt": "2024-01-01"
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
    "0": [ ... ],
    "1": [ ... ]
  },
  "totalBills": 100
}
```

### POST /api/generate-clustering

Generate new clustering.

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
  "message": "Clustering generated successfully"
}
```

## Future Improvements

1. **t-SNE/UMAP Visualization**: Alternative dimensionality reduction methods for better cluster separation
2. **Cluster Labeling**: Automatically extract representative keywords for each cluster
3. **Time Series Analysis**: Track cluster distribution changes over time
4. **Party Analysis**: Which parties submit bills in which clusters
5. **Fine-tuning**: Optimize embedding model on Japanese bill data
6. **Real-time Updates**: Automatically generate embeddings when new bills are added

## License

Follows the project's license.

