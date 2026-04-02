# Adaptive Matching System

This document describes the adaptive matching system that allows users to find parliament members whose voting patterns match their political views.

## Overview

The matching system uses a **Computerized Adaptive Testing (CAT)** approach to efficiently estimate a user's position in a latent political space. By strategically selecting questions about bills, the system minimizes the number of questions needed while maximizing the accuracy of the match.

Key features:
- **Saved vector support**: Pre-calculated cluster vectors can be saved to database for faster session startup
- **Default vector config**: Admin can designate a default vector set for the /match page (`isDefault` flag)
- **Answer persistence**: Answers are persisted per-user in `user_bill_answer` table and auto-populated on session start
- **Vote delegation integration**: Delegated votes are resolved and incorporated into matching sessions
- **Multiple cluster analysis**: Users answer questions across different policy clusters, rate importance, and aggregate results
- **Party matching**: Per-party similarity scores computed alongside individual member matches
- **Result snapshots**: Point-in-time snapshots of matching results can be saved and loaded later
- **Real-time matching**: Live preview of top matching members as users answer questions

## Algorithm

### 1. Latent Space Construction

The system constructs a latent political space using **Weighted SVD (Singular Value Decomposition)** on the member-bill voting matrix. This is performed by `calculate_cluster_vectors.py`.

#### 1.1 Voting Matrix

For a cluster $k$ containing $n$ bills and $M$ members, we construct the raw voting matrix $\mathbf{R} \in \mathbb{R}^{M \times n}$ from legislation scores. Each entry $r_{ij}$ is the normalized score of member $i$ on bill $j$:

$$
r_{ij} = \begin{cases}
\dfrac{s_{ij}}{\max_i s_{ij}} & \text{if } s_{ij} > 0 \\[6pt]
\dfrac{s_{ij}}{|\min_i s_{ij}|} & \text{if } s_{ij} < 0 \\[6pt]
0 & \text{otherwise}
\end{cases}
$$

where $s_{ij}$ is the raw legislation score for member $i$ on bill $j$, and the normalization uses per-bill extrema so that $r_{ij} \in [-1, 1]$.

#### 1.2 Missing Value Imputation

Missing entries (members who did not participate in a vote) are imputed with the column mean:

$$
r_{ij} \leftarrow \bar{r}_{\cdot j} = \frac{1}{|\{i : r_{ij} \neq \text{NaN}\}|} \sum_{i:\, r_{ij} \neq \text{NaN}} r_{ij}
$$

#### 1.3 Bill Outcome Weighting

Each bill $j$ is assigned a confidence weight $w_j$ based on its legislative outcome:

| Result | $w_j$ |
|--------|-------|
| 可決 (passed) | 1.0 |
| null (in deliberation) | 0.8 |
| 否決 (rejected) | 0.6 |
| 撤回 (withdrawn) | 0.3 |
| 未了 (expired) | 0.2 |

The weight matrix is $\mathbf{W} = \text{diag}(w_1, w_2, \ldots, w_n) \in \mathbb{R}^{n \times n}$, and the weighted voting matrix is:

$$
\tilde{\mathbf{R}} = \mathbf{R} \mathbf{W}
$$

#### 1.4 Centering and SVD

The weighted matrix is row-centered:

$$
\mathbf{C} = \tilde{\mathbf{R}} - \bar{\tilde{\mathbf{r}}}_i \mathbf{1}^T, \qquad \bar{\tilde{r}}_i = \frac{1}{n}\sum_{j=1}^{n} \tilde{r}_{ij}
$$

We then compute the truncated SVD with $d$ components ($d \leq \min(M, n)$):

$$
\mathbf{C} \approx \mathbf{U}_d \, \boldsymbol{\Sigma}_d \, \mathbf{V}_d^T
$$

where $\mathbf{U}_d \in \mathbb{R}^{M \times d}$, $\boldsymbol{\Sigma}_d = \text{diag}(\sigma_1, \ldots, \sigma_d)$, and $\mathbf{V}_d \in \mathbb{R}^{n \times d}$.

#### 1.5 Member Latent Vectors and Bill Loadings

Each member $i$'s position in the $d$-dimensional latent space is:

$$
\mathbf{z}_i = (\mathbf{U}_d \boldsymbol{\Sigma}_d)_{i,:} \in \mathbb{R}^d
$$

The bill loading matrix is $\mathbf{V}_d \in \mathbb{R}^{n \times d}$, where row $\mathbf{v}_j$ gives bill $j$'s projection onto each latent dimension.

The explained variance ratio for component $k$ is:

$$
\text{EVR}_k = \frac{\sigma_k^2}{\sum_{l=1}^{\min(M,n)} \sigma_l^2}
$$

### 2. User State Initialization

When a user starts a matching session, the state vector is initialized at the origin of the latent space with maximum uncertainty:

$$
\mathbf{z}_{\text{user}}^{(0)} = \mathbf{0} \in \mathbb{R}^d, \qquad \mathbf{u}^{(0)} = \mathbf{1} \in \mathbb{R}^d
$$

where $\mathbf{u}^{(t)}$ is the per-dimension uncertainty vector at step $t$.

```typescript
MatchingState = {
  clusterId: number,                        // Cluster being analyzed
  clusterLabel: number,                     // Specific label within cluster  
  dimensions: number,                       // d (1-5)
  answeredBills: UserAnswer[],              // List of {billId, score} pairs
  userVector: number[],                     // z_user
  uncertainty: number[],                    // u
  questionCount: number,                    // t
  pendingDelegationBillIds?: Set<number>    // Bills with pending delegations (excluded from vector estimation)
}
```

If the user is logged in, existing answers from `user_bill_answer` and resolved delegated votes are pre-populated into the session at start time. Bills with pending (not-yet-voted) delegations are marked as answered for question skipping but excluded from vector estimation.

### 3. Question Selection (Adaptive Algorithm)

At step $t$, the algorithm selects the next bill to maximize expected **information gain**. For each unanswered bill $j$:

#### 3.1 Uncertainty Score

The uncertainty score measures how much bill $j$'s loading aligns with uncertain dimensions:

$$
S_{\text{unc}}(j) = \sum_{k=1}^{d} |v_{jk}| \cdot u_k^{(t)}
$$

where $v_{jk}$ is the $k$-th component of bill $j$'s loading and $u_k^{(t)}$ is the current uncertainty on dimension $k$.

#### 3.2 Member Variance

The controversy of bill $j$ is measured by projecting all member vectors onto the bill loading direction and computing the variance:

$$
p_i^{(j)} = \mathbf{z}_i \cdot \mathbf{v}_j = \sum_{k=1}^{d} z_{ik} \, v_{jk}
$$

$$
\text{Var}(j) = \frac{1}{M} \sum_{i=1}^{M} \left( p_i^{(j)} - \bar{p}^{(j)} \right)^2, \qquad \bar{p}^{(j)} = \frac{1}{M}\sum_{i=1}^{M} p_i^{(j)}
$$

#### 3.3 Combined Score and Selection

The bill selection criterion combines uncertainty reduction and controversy:

$$
\boxed{Q(j) = S_{\text{unc}}(j) \cdot \left(1 + \sqrt{\text{Var}(j)}\right)}
$$

The algorithm selects $j^* = \arg\max_{j \notin \mathcal{A}} Q(j)$, where $\mathcal{A}$ is the set of already-answered bills.

### 4. User State Update

When the user answers bill $j$ with score $a_j \in \{-1, 0, +1\}$:

#### 4.1 Ridge Regression Estimate

Let $\mathcal{A} = \{(j_1, a_{j_1}), \ldots, (j_t, a_{j_t})\}$ be the set of $t$ answered bills. Construct the design matrix $\mathbf{V}_{\mathcal{A}} \in \mathbb{R}^{t \times d}$ where row $l$ is the loading vector $\mathbf{v}_{j_l}$, and the response vector $\mathbf{a} = (a_{j_1}, \ldots, a_{j_t})^T$.

The user vector is estimated by minimizing the regularized squared error:

$$
\hat{\mathbf{z}}_{\text{user}} = \arg\min_{\mathbf{z}} \left\| \mathbf{a} - \mathbf{V}_{\mathcal{A}} \mathbf{z} \right\|_2^2 + \lambda \|\mathbf{z}\|_2^2
$$

The closed-form solution is:

$$
\boxed{\hat{\mathbf{z}}_{\text{user}} = \left(\mathbf{V}_{\mathcal{A}}^T \mathbf{V}_{\mathcal{A}} + \lambda \mathbf{I}\right)^{-1} \mathbf{V}_{\mathcal{A}}^T \mathbf{a}}
$$

where $\lambda = 0.01$ is the regularization parameter (Tikhonov / ridge). The system is solved via Gaussian elimination with partial pivoting.

#### 4.2 Uncertainty Update

The Fisher information matrix for this linear model is $\mathbf{F} = \mathbf{V}_{\mathcal{A}}^T \mathbf{V}_{\mathcal{A}} + \lambda \mathbf{I}$. The per-dimension uncertainty is derived from its diagonal:

$$
\tilde{u}_k = \frac{1}{\max(F_{kk},\; 0.1)}
$$

Normalized to $[0, 1]$:

$$
u_k^{(t)} = \frac{\tilde{u}_k}{\max_{k'} \tilde{u}_{k'}}
$$

As the user answers more questions, $F_{kk}$ grows and $u_k$ shrinks toward zero. The session terminates when $\max_k u_k^{(t)} < \tau$ (default $\tau = 0.2$) or $t \geq T_{\max}$ (default $T_{\max} = 20$).

### 5. Member Matching

After each answer update, the cosine similarity between the user and each member $i$ is:

$$
\text{sim}(\hat{\mathbf{z}}_{\text{user}},\, \mathbf{z}_i) = \frac{\hat{\mathbf{z}}_{\text{user}} \cdot \mathbf{z}_i}{\|\hat{\mathbf{z}}_{\text{user}}\| \; \|\mathbf{z}_i\|}
= \frac{\displaystyle\sum_{k=1}^{d} \hat{z}_{\text{user},k} \, z_{ik}}{\sqrt{\displaystyle\sum_{k=1}^{d} \hat{z}_{\text{user},k}^2} \;\; \sqrt{\displaystyle\sum_{k=1}^{d} z_{ik}^2}}
$$

Results are sorted by $\text{sim} \in [-1, +1]$, where $+1$ indicates identical orientation in latent space and $-1$ indicates diametrically opposed positions.

## Persistence & Snapshots

Active matching sessions are stored **in-memory** with automatic cleanup after 1 hour. There are no database-persisted "active sessions" — the old `saved_matching_session`, `session_cluster_result`, and `session_answer` tables were removed (see `drizzle/0018_remove_sessions.sql`).

Instead, persistence is achieved through two mechanisms:

### User Bill Answers

All user answers are persisted to the `user_bill_answer` table as they are submitted. When a new session starts or resumes, these answers are automatically loaded and pre-populated into the matching state. This includes:
- Direct user answers (`yes`, `no`, `skip`)
- Resolved delegated votes (via `resolveDelegatedVotes()`)
- Pending delegation placeholders (excluded from vector estimation)

### Result Snapshots

Users can save point-in-time **snapshots** of their matching results. A snapshot captures:

```typescript
interface ResultSnapshot {
  id: number;
  userId: string;                  // Owner of the snapshot
  clusterId: number;               // Which cluster configuration
  name: string;                    // User-provided name
  globalScoresJson: string;        // JSON: GlobalMemberScore[]
  clusterResultsJson: string;      // JSON: per-cluster results with matches and answered bills
  vectorGroupKey: string | null;   // "vectorName|clusterId" — used to reconstruct viz data
  createdAt: Date;
}
```

When a snapshot has a `vectorGroupKey`, the system can reconstruct full visualization data (user vectors, member vectors, explained variance) by loading the cluster vector results from the database and re-estimating the user vector from the stored answered bills.

### Party Matching

After matching, party-level similarity scores are calculated via `calculatePartyScores()` in `party-matching.ts`.

#### Current Roster Mode

For party $P$, let $\mathcal{M}_P^{(c)}$ be the set of members currently affiliated with $P$ who appear in cluster $c$. The per-cluster party score is the arithmetic mean of member similarities:

$$
\bar{s}_P^{(c)} = \frac{1}{|\mathcal{M}_P^{(c)}|} \sum_{i \in \mathcal{M}_P^{(c)}} \text{sim}_c(i)
$$

The global party score aggregates across clusters weighted by importance:

$$
G_P = \sum_{c=1}^{C} \frac{\omega_c}{\sum_{c'} \omega_{c'}} \cdot \bar{s}_P^{(c)}
$$

#### Historical Mode

In historical mode, a member $i$'s contribution is weighted by the **temporal overlap** between their party tenure and the bills' active periods. For member $i$ in party $P$ during cluster $c$:

$$
\alpha_{iP}^{(c)} = \frac{|\{j \in \text{bills}(c) : \text{tenure}(i, P) \cap \text{period}(j) \neq \varnothing\}|}{|\text{bills}(c)|}
$$

where $\text{tenure}(i, P) = [\text{start}_P, \text{end}_P]$ is member $i$'s membership period in party $P$, and $\text{period}(j) = [\text{submitted}_j, \text{result}_j]$ is bill $j$'s active period.

The overlap-weighted cluster score is:

$$
\bar{s}_P^{(c)} = \frac{\sum_{i \in \mathcal{M}_P^{(c)}} \alpha_{iP}^{(c)} \cdot \text{sim}_c(i)}{\sum_{i \in \mathcal{M}_P^{(c)}} \alpha_{iP}^{(c)}}
$$

And the global historical party score follows the same importance-weighted aggregation:

$$
G_P^{\text{hist}} = \sum_{c=1}^{C} \frac{\omega_c}{\sum_{c'} \omega_{c'}} \cdot \bar{s}_P^{(c)}
$$

Returns `PartyScores { current: GlobalPartyScore[], historical: GlobalPartyScore[] }`.

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
   
   Or for backwards compatibility (calculates on-the-fly via Python subprocess):
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
       "result": "可決",
       "reason": "次元1の不確実性を解消（議員間分散: 0.45）",
       "dimensionTarget": 0,
       "billType": "閣法",
       "submissionSession": 213,
       "billNumber": 42
     },
     "uncertainty": [1.0, 1.0, 1.0],
     "userVector": [0, 0, 0],
     "topMatches": [
       { "memberId": 1, "name": "議員名", "group": "政党名", "similarity": 0.95, "rank": 1, "latentVector": [0.4, -0.1, 0.2] }
     ],
     "preExistingAnswerCount": 5,
     "preExistingAnsweredBills": [
       {
         "billId": 100, "title": "法案名", "answer": 1, "source": "direct",
         "billType": "閣法", "submissionSession": 213, "billNumber": 10
       },
       {
         "billId": 200, "title": "法案名", "answer": -1, "source": "delegated",
         "delegationStatus": "voted", "delegateId": "user-uuid"
       }
     ],
     "memberVectors": [
       { "memberId": 1, "name": "議員名", "group": "政党名", "latentVector": [0.4, -0.1, 0.2] }
     ],
     "explainedVariance": [0.35, 0.22, 0.15]
   }
   ```
   
   When a logged-in user starts a session, their existing `user_bill_answer` records and resolved delegated votes are loaded and pre-applied to the matching state. The response includes `preExistingAnswerCount` and `preExistingAnsweredBills` with `source` tracking (`'direct'` or `'delegated'`).

2. **resume** - Resume with existing answers from database
   ```json
   {
     "action": "resume",
     "savedVectorId": 1,
     "existingUserVector": [0.5, -0.2, 0.1],
     "answeredBillIds": [123, 456]
   }
   ```
   
   For logged-in users, `existingUserVector` and `answeredBillIds` are ignored — answers are loaded from the database instead (including delegated votes). For anonymous users, the provided values are used directly.
   
   Response format is identical to `start`.

3. **answer** - Submit an answer
   ```json
   {
     "action": "answer",
     "sessionId": "uuid",
     "billId": 123,
     "score": 1
   }
   ```
   
   Response includes updated `nextQuestion`, `uncertainty`, `userVector`, `topMatches`, and `isComplete`.
   
   **Vote delegation integration**: If the user has an active outgoing delegation for this bill, the delegation is retracted (set to `'rejected'`) and the delegate is notified. If the user's vote changes and they are a delegate with `'voted'` incoming delegations, downstream delegators are notified.

4. **skip** - Skip current question
   ```json
   {
     "action": "skip",
     "sessionId": "uuid",
     "billId": 123
   }
   ```
   
   Persists a `'skip'` answer to `user_bill_answer` (unless the user has an active delegation for this bill).

5. **results** - Get final matching results
   ```json
   {
     "action": "results",
     "sessionId": "uuid"
   }
   ```

6. **retract-answer** - Retract a user's own answer on a bill
   ```json
   {
     "action": "retract-answer",
     "billId": 123
   }
   ```
   
   Requires authentication. Fails if the user has voted on someone else's behalf via delegation for this bill.

7. **direct-vote** - Vote on a bill outside a matching session (e.g., from answer history)
   ```json
   {
     "action": "direct-vote",
     "billId": 123,
     "score": 1
   }
   ```
   
   Requires authentication. Fails if the user has an active outgoing delegation for this bill.

8. **set-default** (admin only) - Set a vector group as the default for /match
   ```json
   {
     "action": "set-default",
     "name": "Vector Config Name",
     "configClusterId": 1
   }
   ```

9. **clear-default** (admin only) - Remove default designation
   ```json
   {
     "action": "clear-default"
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
      "clusterLabelName": "環境・エネルギー",
      "isDefault": true
    }
  ]
}
```

#### `GET /api/saved-sessions`

Requires authentication. Query parameters:

- `(none)` — List all snapshots for the current user
- `id=N` — Get specific snapshot details (includes reconstructed viz data if `vectorGroupKey` present)
- `answers=true` — Get user's bill answers summary
- `answers=true&clusterId=N` — Get answers filtered by cluster

List response:
```json
{
  "success": true,
  "snapshots": [
    {
      "id": 1,
      "name": "My Analysis",
      "clusterId": 1,
      "totalAnswered": 15,
      "topMatch": { "name": "議員名", "score": 0.87 },
      "createdAt": "2024-01-15T12:00:00Z"
    }
  ]
}
```

Snapshot detail response (when `id=N`):
```json
{
  "success": true,
  "snapshot": {
    "id": 1,
    "clusterId": 1,
    "clusterName": "2024年国会法案",
    "name": "My Analysis",
    "globalScores": [{ "memberId": 1, "name": "議員名", "group": "政党名", "globalScore": 0.87, "clusterScores": { "0": 0.9 } }],
    "clusterResults": [{ "clusterLabel": 0, "clusterLabelName": "環境・エネルギー", "importance": 3, "answeredCount": 10, "matches": [...], "userVector": [...], "memberVectorsForViz": [...], "explainedVariance": [...] }],
    "totalAnswered": 15,
    "createdAt": "2024-01-15T12:00:00Z",
    "partyScores": { "current": [...], "historical": [...] }
  }
}
```

#### `POST /api/saved-sessions`

Requires authentication.

##### Actions

1. **snapshot** - Save a point-in-time snapshot of matching results
   ```json
   {
     "action": "snapshot",
     "name": "My Analysis",
     "clusterId": 1,
     "vectorGroupKey": "configName|1",
     "clusterResults": [
       {
         "clusterLabel": 0,
         "clusterLabelName": "環境・エネルギー",
         "importance": 3,
         "answeredCount": 10,
         "matches": [{ "memberId": 1, "name": "議員名", "group": "政党名", "similarity": 0.9 }],
         "answeredBills": [{ "billId": 100, "title": "法案名", "answer": 1 }]
       }
     ]
   }
   ```

2. **delete** - Delete a snapshot
   ```json
   { "action": "delete", "snapshotId": 1 }
   ```

3. **live-results** - Compute real-time results from saved answers (no active session needed)
   ```json
   {
     "action": "live-results",
     "vectorGroupKey": "configName|1",
     "importanceWeights": { "0": 5, "1": 3 }
   }
   ```
   
   Loads all user answers and delegated votes, processes each cluster label in the vector group, estimates user vectors, and returns aggregated global scores with party scores.

4. **backfill-answers** - Backfill `user_bill_answer` for users who matched while logged out
   ```json
   {
     "action": "backfill-answers",
     "answeredBills": [{ "billId": 100, "answer": 1 }, { "billId": 200, "answer": -1 }]
   }
   ```

## UI Flow

The matching interface supports six phases (defined as `MatchingPhase` type):

1. **Setup Phase** (`'setup'`)
   - User selects a pre-calculated vector group (or the default is pre-selected)
   - Existing answers are auto-loaded if logged in
   - Can load a previous snapshot to view saved results

2. **Questioning Phase** (`'questioning'`)
   - Display current bill with title, description, bill type, and session/number metadata
   - User votes: 賛成 (agree: +1), わからない (unsure: 0), 反対 (disagree: -1)
   - Bills with active delegations are shown with delegation status
   - Progress bar shows uncertainty reduction
   - Live preview of top matching members and party scores
   - User can skip questions or finish early (after 3+ answers)

3. **Rating Phase** (`'rating'`)
   - User reviews results for the current cluster label
   - Preview of matches for this cluster

4. **Importance Review Phase** (`'importance-review'`)
   - User rates the importance of each answered cluster (1-5 stars)
   - Can navigate to additional cluster labels in the vector group

5. **Cluster Results Phase** (`'cluster-results'`)
   - Detailed per-cluster results and 2D visualization

6. **Global Results Phase** (`'global-results'`)
   - Aggregated scores across all clusters using importance weights
   - For $C$ clusters with user-assigned importance weights $\omega_c$ and per-cluster cosine similarities $\text{sim}_c(i)$, the global score for member $i$ is:
     $$
     G(i) = \sum_{c=1}^{C} \frac{\omega_c}{\sum_{c'} \omega_{c'}} \cdot \text{sim}_c(i)
     $$
   - Party-level scores (current roster and historical)
   - Option to save a snapshot

## Architecture

| File | Description |
|------|-------------|
| `src/lib/server/matching.ts` | Core matching algorithm (CAT, similarity, question selection, answer conversion) |
| `src/lib/server/party-matching.ts` | Party-level score calculation (current roster + historical) |
| `src/lib/server/delegation-helpers.ts` | Vote delegation resolution (chain walking) |
| `src/lib/types/match.ts` | TypeScript types for matching (phases, results, snapshots, party scores) |
| `src/routes/api/match/+server.ts` | Match API endpoint handlers (start, resume, answer, skip, results, retract-answer, direct-vote, set-default, clear-default) |
| `src/routes/api/saved-sessions/+server.ts` | Snapshot management and live-results API |
| `src/routes/match/+page.svelte` | User interface (6 matching phases) |
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
  is_default BOOLEAN NOT NULL DEFAULT false,  -- Whether this is the default config for /match
  created_at TIMESTAMP DEFAULT NOW()
);

-- User bill answers (persisted per-user, shared across sessions)
CREATE TABLE user_bill_answer (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  bill_id INTEGER NOT NULL REFERENCES bill(id),
  answer bill_answer_value NOT NULL,  -- 'yes', 'no', 'skip', or 'delegated'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, bill_id)
);

-- Point-in-time snapshots of matching results (standalone, no session dependency)
CREATE TABLE result_snapshot (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  cluster_id INTEGER NOT NULL REFERENCES bill_clusters(id),
  name TEXT NOT NULL,
  global_scores_json TEXT NOT NULL,    -- JSON: GlobalMemberScore[]
  cluster_results_json TEXT NOT NULL,  -- JSON: per-cluster results with matches and answered bills
  vector_group_key TEXT,               -- "vectorName|clusterId" for reconstructing viz data
  created_at TIMESTAMP DEFAULT NOW()
);
```

> **Note**: The old `saved_matching_session`, `session_cluster_result`, and `session_answer` tables were removed in migration `0018_remove_sessions.sql`.

## Configuration

### Tunable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `nComponents` | 3 | Number of latent dimensions (1-5) |
| `maxQuestions` | 20 | Maximum questions before auto-complete |
| `uncertaintyThreshold` | 0.2 | Stop when all uncertainties below this |
| `regularizationLambda` | 0.01 | Regularization for least squares solution |

### Session Configuration

Active sessions are stored in-memory with automatic cleanup after 1 hour. Answer persistence is handled separately via `user_bill_answer`:
- Logged-in users have answers auto-saved and auto-loaded on any new session
- Anonymous users can backfill answers after signing up via the `backfill-answers` action
- Result snapshots provide permanent records of matching results
- The `live-results` action can recompute results from saved answers at any time without an active session

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

### Vote Delegation Integration

The matching system is integrated with the vote delegation feature:

- **Session start/resume**: Delegated votes are resolved via `resolveDelegatedVotes()` (walks delegation chains to find the terminal voter's answer) and pre-applied to the user's matching state
- **Pending delegations**: Bills with active but not-yet-voted delegations are marked as answered for question skipping but excluded from vector estimation (their score would be meaningless)
- **Answering**: When a user answers a bill they have delegated, the delegation is retracted (`status: 'rejected'`) and the delegate is notified via `notifyDelegationOverridden()`
- **Vote changes**: If a delegate changes their vote, downstream delegators are notified via `notifyDelegationVoteChanged()` and `notifyUpstreamDelegatorsVoteChanged()`
- **Skipping**: Skip answers are not persisted if the user has an active delegation for that bill
