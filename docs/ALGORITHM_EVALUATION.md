# Algorithm Evaluation

This module provides a benchmark for the adaptive question selection algorithm used in the matching system, comparing it against 3 baseline strategies.

## Overview

The evaluation simulates "users" whose true political positions are known (real Diet members), then measures how quickly each question selection strategy converges to the correct position. This validates that the CAT (Computerized Adaptive Testing) approach outperforms naive alternatives.

### Key Question

> Given a limited number of questions, which strategy most efficiently identifies the user's true political position?

## Strategies Compared

### 1. CAT (Adaptive) — `cat`

The production algorithm implemented in `matching.ts`. Selects questions by scoring each unanswered bill:

```
combinedScore = uncertaintyScore × (1 + √variance)
```

- **uncertaintyScore**: How much the bill's loading aligns with the most uncertain dimensions of the user vector
- **variance**: How much members disagree on the bill (higher = more informative)

Selects the bill with the highest combined score.

### 2. Random — `random`

Uniformly random selection from unanswered bills. Serves as the lower-bound baseline — any useful strategy should outperform this.

Uses a seeded PRNG (`seed = memberId * 31 + strategyIndex * 7919`) for reproducible results.

### 3. Most Controversial — `controversial`

Always picks the bill with the highest member vote variance. This strategy maximizes the "divisiveness" of each question but ignores the user's current uncertainty.

For each unanswered bill:
1. Project all member vectors onto the bill's loading direction
2. Compute the variance of projected scores
3. Select the bill with highest variance

### 4. Round-Robin — `round-robin`

Cycles through latent dimensions in order (dimension 0, 1, 2, ..., then back to 0), picking the bill with the strongest loading on the target dimension each round.

```
targetDim = questionCount % dimensions
```

This ensures coverage of all dimensions but doesn't adapt to the user's specific uncertainty profile.

## Simulation Method

### Ground Truth Generation

Each simulation uses a real Diet member as the "user". Since the matching system only accepts discrete answers — **yes (+1), no (-1), skip (0)** — the same values used in production (`answerToScore()`), we need to generate simulated answers from the member's latent vector:

1. Take the member's true vector from the pre-calculated cluster vector data
2. For each bill, project the member's vector onto the bill's loading direction
3. Convert the continuous projection to a discrete answer (matching the production format):
   - Projection > 0.3 → **+1** (yes)
   - Projection < -0.3 → **-1** (no)
   - Otherwise → **0** (skip)

The threshold of 0.3 is a heuristic for simulating the member's likely response. The resulting scores are the same discrete {-1, 0, +1} values that real users provide in `/match`.

### Simulation Loop

For each (strategy, member) pair:

1. Initialize an empty matching state (zero vector, uniform uncertainty)
2. Use the strategy to select the next bill
3. Look up the member's simulated answer for that bill
4. Update the user vector using Weighted Least Squares (same as production)
5. Compute metrics:
   - Cosine error: `1 − cos(ẑ, z_true)`
   - Vector MSE: mean squared error between estimated and true vector
   - Uncertainty sum: total uncertainty across all dimensions
   - True rank: position of the simulated member in the similarity ranking
   - Top-5 correct: whether the member appears in the top 5 matches
6. Repeat until `maxQuestions` reached or no unanswered bills remain

### Member Sampling

To avoid biased evaluation, members are sampled to cover the latent space:

1. Compute the vector norm for each member
2. Sort members by norm (spreads from moderate to extreme positions)
3. Evenly sample at regular intervals

This ensures the evaluation includes both centrist and polarized members.

## Evaluation Metrics

| Metric | Description | Ideal Value |
|--------|-------------|-------------|
| **Cosine Error** | `1 − cos(ẑ, z_true)`. Distance between estimated and true vector. | 0 (perfect alignment) |
| **True Rank** | Where the simulated member appears in the similarity ranking. | 1 (correctly identified) |
| **Top-5 Hit Rate** | Fraction of simulations where the true member is in the top 5. | 1.0 (always in top 5) |
| **Uncertainty Sum** | Sum of uncertainty across all latent dimensions. | 0 (fully confident) |
| **Questions to Converge** | Number of questions until cosine error drops below the convergence threshold. | Low (fast convergence) |

### Aggregation

Metrics are averaged across all sampled members at each question number. This produces learning curves showing how each strategy's accuracy improves with more questions.

## Expected Results

CAT should demonstrate:
- **Faster convergence** — Reaches low cosine error in fewer questions
- **Better early-stage accuracy** — Even after 5 questions, rank and top-5 rate should be superior
- **Lower uncertainty** — Targeted question selection reduces uncertainty more efficiently

The typical ordering from best to worst:
1. **CAT** — Best overall (adapts to user's specific uncertainty)
2. **Most Controversial** — Good at gathering information but doesn't target weak spots
3. **Round-Robin** — Ensures dimension coverage but not adaptive
4. **Random** — Worst (no intelligence in selection)

## Configuration Parameters

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `savedVectorId` | — | — | ID of the saved cluster vector result to use (required) |
| `maxQuestions` | 20 | 5–50 | Maximum questions per simulation |
| `sampleSize` | 10 | 3–50 | Number of members to simulate |
| `convergeThreshold` | 0.2 | 0.05–1.0 | Cosine error threshold for "converged" |
| `strategies` | All 4 | — | Which strategies to include |

## Architecture

### Files

| File | Purpose |
|------|---------|
| `src/lib/server/matching-evaluation.ts` | Core simulation engine — strategies, simulation loop, aggregation |
| `src/routes/api/evaluation/+server.ts` | REST API endpoint (GET: list vectors, POST: run evaluation) |
| `src/routes/evaluation/+page.server.ts` | Page data loader — fetches available saved vectors |
| `src/routes/evaluation/+page.svelte` | Interactive UI — configuration, charts, per-member drill-down |

### Data Flow

```
User clicks "評価を実行"
         │
         ▼
POST /api/evaluation { savedVectorId, maxQuestions, sampleSize, ... }
         │
         ▼
Load ClusterVectorData from cluster_vector_results table
         │
         ▼
runEvaluation()
  ├── Sample members (stratified by vector norm)
  ├── For each strategy × each member:
  │     ├── simulateMemberAnswers() → ground truth answer map
  │     ├── runSingleSimulation() → step-by-step metrics
  │     └── Return StrategyResult with EvaluationStep[]
  └── aggregateResults() per strategy → AggregatedMetrics[]
         │
         ▼
JSON response with aggregated curves + per-member detail
         │
         ▼
UI renders: summary cards, line charts, member drill-down, comparison table
```

### API Reference

#### `GET /api/evaluation`

Returns available saved vector configurations.

**Response:**
```json
{
  "savedVectors": [
    {
      "id": 1,
      "clusterId": 5,
      "clusterLabel": 3,
      "name": "Default Config",
      "dimensions": 5,
      "memberCount": 150,
      "billCount": 200,
      "isDefault": true,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

#### `POST /api/evaluation`

Run the evaluation benchmark.

**Request:**
```json
{
  "savedVectorId": 1,
  "maxQuestions": 20,
  "sampleSize": 10,
  "convergeThreshold": 0.2,
  "strategies": ["cat", "random", "controversial", "round-robin"]
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "aggregated": [
      {
        "strategy": "cat",
        "avgCosineError": [0.85, 0.62, 0.41, ...],
        "avgVectorMSE": [...],
        "avgUncertaintySum": [...],
        "avgTrueRank": [45.2, 22.1, 8.3, ...],
        "top5Rate": [0.0, 0.1, 0.3, ...],
        "avgQuestionsToConverge": 8.5
      }
    ],
    "memberCount": 150,
    "billCount": 200,
    "dimensions": 5,
    "clusterLabel": 3,
    "sampleMemberIds": [101, 203, 305, ...],
    "perMember": [
      {
        "strategy": "cat",
        "memberId": 101,
        "memberName": "山田太郎",
        "finalCosineError": 0.042,
        "finalRank": 1,
        "steps": [
          {
            "questionNumber": 1,
            "billId": 500,
            "cosineError": 0.92,
            "vectorMSE": 0.45,
            "uncertaintySum": 4.2,
            "top1Correct": false,
            "top5Correct": false,
            "trueRank": 67
          }
        ]
      }
    ]
  }
}
```

## Relationship to Adaptive Matching

This evaluation module reuses the core matching infrastructure:

- **`initializeMatchingState()`** — Same state initialization as production
- **`estimateUserVector()`** — Same WLS estimation with regularization
- **`selectNextQuestion()`** — The CAT strategy calls the same function used in `/match`
- **`cosineSimilarity()`** — Same similarity metric
- **`findMatchingMembers()`** — Same ranking function

The only additions are the 3 baseline strategies and the simulation/aggregation harness. This ensures the evaluation accurately reflects real-world performance.

## Web Interface

**URL**: `/evaluation`

The interactive page provides:

1. **Collapsible explanation** — Overview of what the evaluation does, strategies compared, and metrics explained
2. **Configuration panel** — Select vector data, set max questions, sample size, and convergence threshold
3. **Summary cards** — One per strategy showing key final metrics (convergence speed, final error, top-5 rate, rank)
4. **Tabbed line charts** — SVG charts showing metric learning curves over question count, with all 4 strategies overlaid
5. **Per-member drill-down** — Select individual sampled members to see step-by-step tables per strategy
6. **Convergence comparison table** — Side-by-side comparison of all strategies including early-stage (Q5) metrics
