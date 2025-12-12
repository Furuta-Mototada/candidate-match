# Adaptive Matching System

This document describes the adaptive matching system that allows users to find parliament members whose voting patterns match their political views.

## Overview

The matching system uses a **Computerized Adaptive Testing (CAT)** approach to efficiently estimate a user's position in a latent political space. By strategically selecting questions about bills, the system minimizes the number of questions needed while maximizing the accuracy of the match.

Key features:
- **Saved vector support**: Pre-calculated cluster vectors can be saved to database for faster session startup
- **Session persistence**: Matching sessions can be saved and resumed later
- **Multiple cluster analysis**: Users can answer questions across different policy clusters
- **Real-time matching**: Live preview of top matching members as users answer questions

## Algorithm

### 1. Latent Space Construction

The system first constructs a latent political space using **Weighted SVD (Singular Value Decomposition)** on the member-bill voting matrix. This is performed by `calculate_cluster_vectors.py`:

1. Collect all voting records for bills in a cluster (from `legislation_scores.json`)
2. Apply weights based on bill outcome:
   - Passed bills (可決): 1.0 (highest confidence)
   - In-progress bills (null result): 0.8 (moderate confidence)
   - Expired bills (未了): 0.2 (low confidence)
   - Rejected bills (否決): 0.6 (lower confidence)
   - Withdrawn bills (撤回): 0.3 (lowest confidence)
3. Impute missing values using column mean (average vote for that bill)
4. Perform SVD to extract principal components
5. Project each member into the latent space

### 2. User State Initialization

When a user starts a matching session:

```typescript
MatchingState = {
  clusterId: number,              // Cluster being analyzed
  clusterLabel: number,           // Specific label within cluster  
  dimensions: number,             // Number of latent dimensions (1-5)
  answeredBills: UserAnswer[],    // List of {billId, score} pairs
  userVector: number[],           // Position in latent space (starts at origin)
  uncertainty: number[],          // Uncertainty per dimension (starts at 1.0)
  questionCount: number           // Number of questions answered
}
```

### 3. Question Selection (Adaptive Algorithm)

The next question is selected to maximize **information gain**. The algorithm (in `matching.ts`):

1. Find dimensions with highest uncertainty
2. For each unanswered bill:
   - Calculate how much its loading aligns with uncertain dimensions (`uncertaintyScore`)
   - Calculate variance in member votes (higher variance = more controversial)
   - Combine scores: `uncertaintyScore × (1 + sqrt(variance))`
3. Select the bill with the highest combined score

```typescript
// Combined score calculation
const combinedScore = uncertaintyScore * (1 + Math.sqrt(variance));
```

### 4. User State Update

When the user answers a question (score: -1, 0, or 1):

1. Record the answer:
   ```typescript
   state.answeredBills.push({ billId, score });
   ```

2. Update user vector using weighted least squares estimation:
   - Build design matrix V from bill loadings
   - Solve: `z_user = (V^T V + λI)^-1 V^T scores` (with regularization λ=0.01)
   - Use Gaussian elimination for the linear system

3. Update uncertainty:
   - Uncertainty is inversely related to information: `uncertainty[i] = 1 / max(V^T V[i][i], 0.1)`
   - Normalize to [0, 1] range

### 5. Member Matching

After each answer, calculate cosine similarity between user and all members:

```typescript
similarity(user, member) = dot(user, member) / (|user| × |member|)
```

Results are sorted by similarity, with values ranging from -1 (opposite) to +1 (identical).

## Saved Sessions

The system supports saving and resuming matching sessions:

### Session Structure

```typescript
interface SavedMatchingSession {
  id: number;
  name: string;
  description: string;
  savedVectorKey: string;      // Links to pre-calculated vectors
  clusterId: number;
  nComponents: number;
  status: 'in_progress' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

interface SessionClusterResult {
  sessionId: number;
  clusterLabel: number;
  clusterLabelName: string;    // Human-readable cluster name
  userVector: string;          // JSON-encoded user position
  importance: number;          // Weight for aggregating results
  answeredCount: number;
  matchesJson: string;         // Top matching members
}
```

### Result Snapshots

Users can save snapshots of their progress at any time. This allows tracking how matches change as more questions are answered.

## API Reference

### Endpoints

#### `POST /api/match`

##### Actions

1. **start** - Start a new matching session
   ```json
   {
     "action": "start",
     "savedVectorId": 1,
     "nComponents": 3
   }
   ```
   
   Or for backwards compatibility (calculates on-the-fly):
   ```json
   {
     "action": "start",
     "clusterId": 1,
     "clusterLabel": 0,
     "nComponents": 3
   }
   ```
   
   Response:
   ```json
   {
     "success": true,
     "sessionId": "uuid",
     "clusterId": 1,
     "clusterLabel": 0,
     "clusterName": "2024 Regular Session Bills",
     "dimensions": 3,
     "totalBills": 45,
     "totalMembers": 389,
     "questionCount": 0,
     "nextQuestion": {
       "billId": 123,
       "title": "法案タイトル",
       "description": "法案の説明",
       "passed": true,
       "reason": "次元1の不確実性を解消（議員間分散: 0.45）",
       "dimensionTarget": 0
     },
     "uncertainty": [1.0, 1.0, 1.0],
     "userVector": [0, 0, 0],
     "memberVectors": [
       { "memberId": 1, "name": "議員名", "group": "政党名", "latentVector": [0.4, -0.1, 0.2] }
     ],
     "explainedVariance": [0.35, 0.22, 0.15]
   }
   ```

2. **resume** - Resume with existing user vector (for saved sessions)
   ```json
   {
     "action": "resume",
     "savedVectorId": 1,
     "existingUserVector": [0.5, -0.2, 0.1],
     "answeredBillIds": [123, 456]
   }
   ```

3. **answer** - Submit an answer
   ```json
   {
     "action": "answer",
     "sessionId": "uuid",
     "billId": 123,
     "score": 1
   }
   ```
   
   Response includes updated `nextQuestion`, `uncertainty`, `userVector`, and `topMatches`.

4. **skip** - Skip current question
   ```json
   {
     "action": "skip",
     "sessionId": "uuid",
     "billId": 123
   }
   ```

5. **results** - Get final matching results
   ```json
   {
     "action": "results",
     "sessionId": "uuid"
   }
   ```

#### `GET /api/match`

Get available clusters and saved vector results for matching:

```json
{
  "success": true,
  "clusters": [
    {
      "id": 1,
      "name": "2024年国会法案",
      "algorithm": "kmeans",
      "parameters": "...",
      "createdAt": "2024-01-01T00:00:00Z",
      "labels": [
        { "label": 0, "billCount": 45 },
        { "label": 1, "billCount": 32 }
      ]
    }
  ],
  "savedVectors": [
    {
      "id": 1,
      "clusterId": 1,
      "clusterLabel": 0,
      "nComponents": 3,
      "name": "2024 Bills Analysis",
      "dimensions": 3,
      "memberCount": 389,
      "billCount": 45,
      "createdAt": "2024-01-01T00:00:00Z",
      "clusterLabelName": "環境・エネルギー"
    }
  ]
}
```

#### `GET /api/saved-sessions`

Get all saved matching sessions:

```json
{
  "success": true,
  "sessions": [
    {
      "id": 1,
      "name": "My Analysis",
      "description": "Description",
      "status": "in_progress",
      "totalAnswered": 15,
      "totalBills": 100,
      "clusterCount": 3,
      "latestSnapshotDate": "2024-01-15T12:00:00Z",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T12:00:00Z"
    }
  ]
}
```

#### `POST /api/saved-sessions`

Create or update a saved matching session.

## UI Flow

1. **Setup Phase**
   - User selects a pre-calculated vector set (or creates a new one)
   - Optionally selects a specific cluster label
   - Can create a new saved session or resume an existing one

2. **Questioning Phase**
   - Display current bill with title and description
   - User votes: 賛成 (agree: +1), わからない (unsure: 0), 反対 (disagree: -1)
   - Progress bar shows uncertainty reduction
   - Live preview of top matching members
   - User can skip questions or finish early (after 3+ answers)
   - Cluster importance can be weighted for cross-cluster analysis

3. **Results Phase**
   - Show top matching members with similarity percentages
   - Display user's estimated political vector
   - 2D visualization of members in latent space with user position
   - Option to save session for later continuation
   - Aggregate scores across multiple clusters using importance weights

## Implementation Files

| File | Description |
|------|-------------|
| `src/lib/server/matching.ts` | Core matching algorithm (CAT, similarity, question selection) |
| `src/routes/api/match/+server.ts` | Match API endpoint handlers |
| `src/routes/api/saved-sessions/+server.ts` | Saved session management API |
| `src/routes/match/+page.svelte` | User interface |
| `src/routes/match/+page.server.ts` | Server-side data loading |
| `scripts/calculate_cluster_vectors.py` | Python script for SVD/latent vector calculation |

## Database Schema

### Related Tables

```sql
-- Pre-calculated cluster vectors
CREATE TABLE cluster_vector_results (
  id SERIAL PRIMARY KEY,
  cluster_id INTEGER REFERENCES bill_clusters(id),
  cluster_label INTEGER NOT NULL,
  n_components INTEGER NOT NULL,      -- Number of PCA dimensions
  name TEXT NOT NULL,                 -- User-provided name for this calculation
  member_vectors TEXT NOT NULL,       -- JSON: Record<string, number[]>
  member_names TEXT NOT NULL,         -- JSON: Record<string, string>
  bill_loadings TEXT NOT NULL,        -- JSON: number[][]
  bill_ids TEXT NOT NULL,             -- JSON: number[]
  explained_variance TEXT NOT NULL,   -- JSON: number[]
  dimensions INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  bill_count INTEGER NOT NULL,
  representative_bills TEXT,          -- JSON: RepresentativeBill[][] (optional)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Saved matching sessions
CREATE TABLE saved_matching_session (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  saved_vector_key TEXT NOT NULL,     -- "name|clusterId" key for the saved vector group
  cluster_id INTEGER REFERENCES bill_clusters(id),
  n_components INTEGER NOT NULL,
  status TEXT DEFAULT 'in_progress',  -- 'in_progress' or 'completed'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Per-cluster results within a session
CREATE TABLE session_cluster_result (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES saved_matching_session(id) ON DELETE CASCADE,
  cluster_label INTEGER NOT NULL,
  cluster_label_name TEXT,
  user_vector TEXT NOT NULL,           -- JSON: number[]
  importance INTEGER DEFAULT 3,        -- 1-5 rating
  answered_count INTEGER DEFAULT 0,
  matches_json TEXT NOT NULL,          -- JSON: MemberMatch[]
  member_vectors_viz_json TEXT,        -- JSON: MemberVectorForViz[]
  explained_variance_json TEXT,        -- JSON: number[]
  user_vector_history_json TEXT,       -- JSON: number[][]
  x_dimension INTEGER DEFAULT 0,
  y_dimension INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, cluster_label)
);

-- Individual bill answers within a cluster result
CREATE TABLE session_answer (
  id SERIAL PRIMARY KEY,
  cluster_result_id INTEGER REFERENCES session_cluster_result(id) ON DELETE CASCADE,
  bill_id INTEGER REFERENCES bill(id),
  bill_title TEXT NOT NULL,
  score INTEGER NOT NULL,              -- -1, 0, or 1
  answered_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(cluster_result_id, bill_id)
);

-- Point-in-time snapshots of matching results
CREATE TABLE result_snapshot (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES saved_matching_session(id) ON DELETE CASCADE,
  snapshot_number INTEGER DEFAULT 1,
  name TEXT,
  global_scores_json TEXT NOT NULL,    -- JSON: GlobalMemberScore[]
  cluster_results_json TEXT NOT NULL,  -- JSON: summary of cluster results
  total_answered INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(session_id, snapshot_number)
);
```

## Configuration

### Tunable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `nComponents` | 3 | Number of latent dimensions (1-5) |
| `maxQuestions` | 20 | Maximum questions before auto-complete |
| `uncertaintyThreshold` | 0.2 | Stop when all uncertainties below this |
| `regularizationLambda` | 0.01 | Regularization for least squares solution |

### Session Configuration

Sessions are stored in-memory with automatic cleanup after 1 hour. For production:
- Saved sessions persist to PostgreSQL database
- Can be resumed with `action: "resume"`
- Support for result snapshots at any point

## Technical Notes

### Pre-calculated Vectors

For efficiency, cluster vectors can be pre-calculated and stored:

```bash
# Calculate and display vectors
python scripts/calculate_cluster_vectors.py --cluster-id 1 --n-components 3

# Output is JSON that can be saved to cluster_vector_results table
```

### Accuracy Considerations

- Minimum 3 questions required for meaningful results
- Optimal range is 5-10 questions
- Bills with higher member variance provide more information
- Passed bills are weighted higher (more reliable voting data)

### Performance

- Pre-calculated vectors load instantly from database
- On-the-fly calculation takes 10-30 seconds (uses Python subprocess)
- Question selection is O(n) where n = number of bills
- Member matching is O(m) where m = number of members
- All operations complete in < 100ms for typical datasets with pre-calculated vectors
