# Adaptive Matching System

This document describes the adaptive matching system that allows users to find parliament members whose voting patterns match their political views.

## Overview

The matching system uses a **Computerized Adaptive Testing (CAT)** approach to efficiently estimate a user's position in a latent political space. By strategically selecting questions about bills, the system minimizes the number of questions needed while maximizing the accuracy of the match.

## Algorithm

### 1. Latent Space Construction

The system first constructs a latent political space using **Weighted SVD (Singular Value Decomposition)** on the member-bill voting matrix:

1. Collect all voting records for bills in a cluster
2. Apply weights based on bill outcome:
   - Passed bills: 1.0 (highest confidence)
   - In-progress bills: 0.8 (moderate confidence)
   - Failed/rejected bills: 0.6 (lower confidence)
3. Perform SVD to extract principal components
4. Project each member into the latent space

### 2. User State Initialization

When a user starts a matching session:

```typescript
UserState = {
  userVector: [0, 0, ..., 0],     // Position in latent space (starts at origin)
  uncertainty: [1, 1, ..., 1],    // Uncertainty per dimension (starts high)
  answeredBills: [],               // List of answered bill IDs
  questionCount: 0
}
```

### 3. Question Selection (Adaptive Algorithm)

The next question is selected to maximize **information gain** using the formula:

```
score(bill) = uncertaintyScore × (1 + sqrt(variance))
```

Where:
- **uncertaintyScore**: How well the bill's loadings align with uncertain dimensions
- **variance**: How much members disagree on this bill (higher = more discriminating)

Steps:
1. Find the dimension with highest uncertainty
2. For each unanswered bill:
   - Calculate how much its loading aligns with uncertain dimensions
   - Calculate variance in member votes (higher variance = more controversial)
   - Combine scores: alignment × (1 + sqrt(variance))
3. Select the bill with the highest combined score

### 4. User State Update

When the user answers a question (score: -1, 0, or 1):

1. Create an answer object:
   ```typescript
   answer = { billId, score, weight: 1.0 }
   ```

2. Update user vector using weighted least squares:
   - Use the bill's loadings in the latent space
   - Apply momentum to smooth updates
   - Bound values to [-2, 2] range

3. Update uncertainty:
   - Reduce uncertainty in dimensions where the bill has high loadings
   - Formula: `newUncertainty = oldUncertainty × (1 - |loading| × factor)`

### 5. Member Matching

After each answer, calculate cosine similarity between user and all members:

```typescript
similarity(user, member) = dot(user, member) / (|user| × |member|)
```

Sort members by similarity to get the ranking.

## API Reference

### Endpoints

#### `POST /api/match`

##### Actions

1. **start** - Start a new matching session
   ```json
   {
     "action": "start",
     "clusterId": 1,
     "clusterLabel": null,
     "nComponents": 3
   }
   ```
   
   Response:
   ```json
   {
     "success": true,
     "sessionId": "uuid",
     "nextQuestion": {
       "billId": 123,
       "title": "法案タイトル",
       "description": "法案の説明",
       "passed": true,
       "reason": "次元1の不確実性を減らすため",
       "dimensionTarget": 0
     }
   }
   ```

2. **answer** - Submit an answer
   ```json
   {
     "action": "answer",
     "sessionId": "uuid",
     "billId": 123,
     "score": 1  // -1 (反対), 0 (わからない), 1 (賛成)
   }
   ```
   
   Response:
   ```json
   {
     "success": true,
     "questionCount": 5,
     "answeredBills": 4,
     "nextQuestion": { ... },
     "uncertainty": [0.3, 0.5, 0.7],
     "userVector": [0.5, -0.2, 0.1],
     "topMatches": [
       { "memberId": 1, "name": "議員名", "group": "政党名", "similarity": 0.85 }
     ],
     "isComplete": false
   }
   ```

3. **skip** - Skip current question
   ```json
   {
     "action": "skip",
     "sessionId": "uuid",
     "billId": 123
   }
   ```

4. **results** - Get final matching results
   ```json
   {
     "action": "results",
     "sessionId": "uuid"
   }
   ```
   
   Response:
   ```json
   {
     "success": true,
     "matches": [
       {
         "memberId": 1,
         "name": "議員名",
         "group": "政党名",
         "similarity": 0.85,
         "rank": 1,
         "latentVector": [0.4, -0.1, 0.2]
       }
     ]
   }
   ```

#### `GET /api/match`

Get available clusters for matching:

```json
{
  "success": true,
  "clusters": [
    {
      "id": 1,
      "name": "2024年国会法案",
      "algorithm": "kmeans",
      "labels": [
        { "label": 0, "billCount": 45 },
        { "label": 1, "billCount": 32 }
      ]
    }
  ]
}
```

## UI Flow

1. **Setup Phase**
   - User selects a cluster (set of bills to analyze)
   - Optionally selects a specific cluster label
   - Chooses number of latent dimensions (2-5)

2. **Questioning Phase**
   - Display current bill with title and description
   - User votes: 賛成 (agree), わからない (unsure), 反対 (disagree)
   - Progress bar shows confidence level
   - Live preview of top matching members
   - User can skip questions or finish early (after 3+ answers)

3. **Results Phase**
   - Show top 10 matching members with similarity percentages
   - Display user's estimated political vector
   - Full table of all analyzed members

## Implementation Files

| File | Description |
|------|-------------|
| `src/lib/server/matching.ts` | Core matching algorithm |
| `src/routes/api/match/+server.ts` | API endpoint handlers |
| `src/routes/match/+page.svelte` | User interface |
| `src/routes/match/+page.server.ts` | Server-side data loading |

## Configuration

### Tunable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `nComponents` | 3 | Number of latent dimensions |
| `maxQuestions` | 20 | Maximum questions before auto-complete |
| `uncertaintyThreshold` | 0.2 | Stop when all uncertainties below this |
| `updateMomentum` | 0.3 | Smoothing factor for vector updates |
| `uncertaintyReductionRate` | 0.3 | How fast uncertainty decreases |

## Technical Notes

### Session Management

Sessions are stored in-memory with automatic cleanup after 1 hour. For production deployment, consider:
- Redis for session storage
- Database persistence for resumable sessions
- Rate limiting per IP/user

### Accuracy Considerations

- Minimum 3 questions required for meaningful results
- Optimal range is 5-10 questions
- Bills with higher member variance provide more information
- Passed bills are weighted higher (more reliable voting data)

### Performance

- Cluster vector calculation is done once and cached
- Question selection is O(n) where n = number of bills
- Member matching is O(m) where m = number of members
- All operations complete in < 100ms for typical datasets
