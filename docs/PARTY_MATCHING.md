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

Two periods overlap when: `billStart ≤ tenureEnd AND tenureStart ≤ billEnd` (with null start = beginning of time, null end = present).

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
| Party membership history | `memberParty` | `memberId, partyId, startDate, endDate` |
| Bill active period | `bill` | `submissionDate, resultDate` |
| Session dates (fallback) | `congressSession` | `sessionNumber, startDate` |
| Cluster bill assignments | `clusterVectorResults.billIds` | JSON array of bill IDs per cluster |

## Architecture

### Server Module

`src/lib/server/party-matching.ts` — `calculatePartyScores(clusterResults, vectorGroupKey?)`

- Input: cluster match results (same as used for global MP scores) + optional vector group key (needed for historical mode)
- Output: `{ current: GlobalPartyScore[], historical: GlobalPartyScore[] }`
- Historical mode requires `vectorGroupKey` to look up which bills belong to each cluster

### API Endpoints

- **POST `/api/party-match`** — Standalone endpoint for computing party scores
- Party scores are also included in:
  - `POST /api/saved-sessions` (live-results action)
  - `GET /api/saved-sessions?id=N` (snapshot details)

### UI Components

- **`GlobalResultsPhase.svelte`** — "政党マッチ" tab with mode toggle and party ranking table
- **`QuestioningPhase.svelte`** — Interim "政党マッチ (暫定)" section in the side panel during questioning
- Party scores are available in both the live match flow and saved snapshot views

## Edge Cases

- **Independent MPs**: excluded from party view (remain visible in member view)
- **Parties with few members**: shown with member count so users can assess confidence
- **Bills without dates**: fall back to `congressSession.startDate` via `submissionSession`
- **Members not in any cluster**: naturally excluded (they don't appear in `clusterVectorResults`)
- **No vectorGroupKey**: historical mode returns empty; only current roster is computed
