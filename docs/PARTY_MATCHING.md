# Party Matching (政党マッチング)

This module derives **party-level matching scores** from the existing member-level adaptive matching results. No additional SVD or latent vector computation is needed — party scores are aggregated from individual MP similarities.

## Overview

After the user completes the adaptive matching questionnaire, they receive per-cluster cosine similarity scores for each MP. Party matching aggregates these MP-level scores into party-level scores using two complementary methods:

1. **Current Roster (現在の所属議員)** — Party score = average of its currently affiliated MPs
2. **Historical Actions (在籍期間の行動)** — Party score = weighted average based on temporal overlap between each MP's party tenure and each bill's active period

Both methods produce a global party score and per-cluster party scores, consistent with the MP-level scoring.

## Method A: Current Roster (現在の所属議員ベース)

### Logic

A party's score is the arithmetic mean of its **currently affiliated** members' similarity scores.

For each cluster $c$ and party $p$:

$$
\text{partyClusterScore}(p, c) = \frac{1}{|M_p|} \sum_{m \in M_p} \text{similarity}(m, c)
$$

Where $M_p$ = set of members whose `memberParty.endDate IS NULL` for party $p$.

### Global Score

$$
\text{partyGlobalScore}(p) = \frac{\sum_{c} \text{partyClusterScore}(p, c) \times \text{importance}(c)}{\sum_{c} \text{importance}(c)}
$$

### Characteristics

- Simple and intuitive: "How well do the current members of this party match you?"
- A member who just joined yesterday counts equally to a long-standing member
- Independent MPs (no current party affiliation) are excluded

## Method B: Historical Actions (在籍期間の行動ベース)

### Logic

A member's similarity score is attributed to the party they belonged to **during the time each cluster's bills were active**. If a member switched parties during a bill's lifecycle, they contribute to multiple parties proportionally.

### Temporal Overlap

Each bill has an **active period**: from `submissionDate` to `resultDate`. If `resultDate` is missing, the submission date alone is used.

For each (member $m$, party tenure $t$, cluster $c$):

1. Get all bill IDs in the cluster from `clusterVectorResults.billIds`
2. For each bill, check if the bill's active period `[submissionDate, resultDate]` **overlaps** with the member's party tenure `[startDate, endDate]`
3. Count the overlapping bills:

$$
\text{overlapFraction}(m, t, c) = \frac{|\text{bills in cluster} \cap \text{bills overlapping tenure}|}{|\text{bills in cluster}|}
$$

Two periods overlap when: `billStart ≤ tenureEnd AND tenureStart ≤ billEnd` (with null start = beginning of time, null end = present). This is implemented via the `doPeriodsOverlap()` helper function.

### Per-Cluster Score (Weighted Average)

$$
\text{partyClusterScore}(p, c) = \frac{\sum_{m} \text{similarity}(m, c) \times \text{overlapFraction}(m, p, c)}{\sum_{m} \text{overlapFraction}(m, p, c)}
$$

### Global Score

Same importance-weighted formula as Method A:

$$
\text{partyGlobalScore}(p) = \frac{\sum_{c} \text{partyClusterScore}(p, c) \times \text{importance}(c)}{\sum_{c} \text{importance}(c)}
$$

### Characteristics

- Accounts for party switches: a member contributes to the party they were in when bills were proposed and voted on
- A single member can contribute to **multiple parties** with different weights
- More historically accurate: credits a party for what its members actually did while affiliated
- The result date matters: if a bill was submitted under Party A but voted on under Party B, both parties get credit

## Data Sources

| Data | Source Table | Key Fields |
|------|-------------|------------|
| Member similarity per cluster | `clusterVectorResults` | Member latent vectors → cosine similarity with user |
| Party membership history | `memberParty` | `memberId, partyId, chamber, startDate, endDate` |
| Bill active period | `bill` | `submissionDate, resultDate, submissionSession` |
| Session dates (fallback) | `congressSession` | `sessionNumber, startDate` |
| Cluster bill assignments | `clusterVectorResults.billIds` | JSON array of bill IDs per cluster |
| Snapshot storage | `resultSnapshot` | `vectorGroupKey` — stores `"vectorName\|clusterId"` for historical mode reconstruction |

## Type Definitions

```typescript
interface ClusterMatchInput {
  clusterLabel: number;
  importance: number;
  matches: Array<{ memberId: number; name: string; group: string | null; similarity: number }>;
}

interface GlobalPartyScore {
  partyId: number;
  partyName: string;
  globalScore: number;                    // 0–1 range
  clusterScores: Record<number, number>;  // clusterLabel → similarity
  memberCount: number;                    // Number of contributing members
}

interface PartyScores {
  current: GlobalPartyScore[];
  historical: GlobalPartyScore[];
}
```

## Architecture

### Server Module

`src/lib/server/party-matching.ts` — `calculatePartyScores(clusterResults, vectorGroupKey?)`

- **Input**: `ClusterMatchInput[]` (cluster label, importance weight, and member matches with similarity scores) + optional `vectorGroupKey` in `"vectorName|clusterId"` format (needed for historical mode)
- **Output**: `PartyScores` → `{ current: GlobalPartyScore[], historical: GlobalPartyScore[] }`
- Historical mode requires `vectorGroupKey` to look up which bills belong to each cluster via `clusterVectorResults`
- Key internal functions:
  - `calculateCurrentRoster()` — Mode A: simple average per party (`computeGlobalPartyScores()`)
  - `calculateHistorical()` — Mode B: overlap-weighted average (`computeGlobalPartyScoresWeighted()`)
  - `doPeriodsOverlap()` — Temporal overlap detection with null handling

### API Endpoints

- **POST `/api/party-match`** — Standalone endpoint for computing party scores. Accepts `{ clusterResults, vectorGroupKey? }`, returns `{ success, partyScores }`.
- Party scores are also included in:
  - **POST `/api/saved-sessions`** (`action: "snapshot"`) — Stores `vectorGroupKey` in `resultSnapshot` table. Party scores are **not** stored — they are computed on demand at retrieval time.
  - **POST `/api/saved-sessions`** (`action: "live-results"`) — Recalculates matching from stored `userBillAnswer` entries and computes party scores.
  - **GET `/api/saved-sessions?id=N`** — Retrieves snapshot, reconstructs `clusterResults` from stored data, and calls `calculatePartyScores()` with the stored `vectorGroupKey` to produce both current and historical party scores.

### UI Components

- **`GlobalResultsPhase.svelte`** — "政党マッチ" tab (one of four tabs: overview, 回答記録, 全議員リスト, 政党マッチ). The tab only appears when `partyScores` data is available. Contains:
  - Mode toggle between "現在の所属議員" and "在籍期間の行動" (historical button disabled when no historical data)
  - Mode description text explaining each calculation method to users
  - Top 3 party spotlight cards with rank badges (gold/silver/bronze), party name, member count, and score
  - Sortable party ranking table: columns for 順位 (rank), 政党名 (party name), 議員数 (member count), 総合 (global score), plus per-cluster score columns. All columns are sortable, and party name is searchable.
  - Expandable explanation section ("政党マッチの計算方法について") at the bottom

- **`QuestioningPhase.svelte`** — "政党マッチ" card inside the "暫定マッチング結果" (interim results) section of the side panel during questioning. Contains:
  - Mode toggle (same as GlobalResultsPhase)
  - Searchable party table with columns: # (rank), 政党名 (party name), 人数 (member count), マッチ度 (match score)
  - Auto-updates via `fetchPartyScores()` triggered by `$effect` on `topMatches` changes (debounced 300ms)

- **`src/routes/match/+page.svelte`** — Orchestrates party score fetching via `fetchPartyScores()`:
  - Collects cluster data from completed clusters
  - For the current active cluster, fetches **all members** (not just top 5) via `/api/match` with `action: 'results'`
  - Calls `/api/party-match` with `{ clusterResults, vectorGroupKey: selectedSavedVectorKey }`
  - Passes `partyScores` to both `QuestioningPhase` (as `interimPartyScores`) and `GlobalResultsPhase`

## Edge Cases

- **Independent MPs**: excluded from party view (remain visible in member view)
- **Parties with few members**: shown with member count so users can assess confidence
- **Bills without dates**: fall back to `congressSession.startDate` via `bill.submissionSession`
- **Members not in any cluster**: naturally excluded (they don't appear in `clusterVectorResults`)
- **No vectorGroupKey**: historical mode returns empty array; only current roster is computed
- **Empty cluster results**: both modes return empty arrays immediately
- **Invalid vectorGroupKey format**: if `|` separator not found or `clusterId` is NaN, historical mode returns empty
