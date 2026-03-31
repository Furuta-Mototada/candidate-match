# Legislation Scores Analysis

This module provides a comprehensive analysis of parliamentary members' scores for each piece of legislation.

## Overview

Instead of calculating a total score per member, this system calculates scores for **each legislation**, showing how all members voted or participated in that specific bill. The scores are used as input for the adaptive matching algorithm.

## Features

### 1. Legislation-Based Scoring
- Each bill shows participating members' scores for that specific legislation
- View positive (supportive) and negative (opposing) members
- See average scores per legislation
- Histogram charts showing score distribution (raw and normalized)

### 2. Interactive Web Interface
- **Location**: `/legislation-scores`
- Search bills by title
- Filter by bill type, Diet session (回次), and result status
- Sort by various criteria (bill ID, positive count, negative count, average score)
- Click on any bill row to see:
  - **Raw score histogram** showing distribution of member scores
  - **Normalized score histogram** showing distribution in [-1, 1] range (0.1 increments)
  - Complete table of all participating members with score breakdowns
  - Color-coded visualization (green=positive, red=negative, gray=zero)
  - Member search within the modal to filter by member name
- Recalculate button (admin-only, with confirmation dialog and SSE progress)

### 3. Score Calculation Logic

The calculation uses **extended group membership dates** for accurate attribution. This means:
- Group membership dates are extended using `member_party` records
- A member's effective group membership spans from their party start date to the next group's start date
- This handles gaps between official group records

#### Bill Submission (議案提出)
- **Bill Sponsor (議案提出者)**: +10 points
  - Can be multiple members
  - For Cabinet Bills (閣法), the Prime Minister (内閣総理大臣) is recorded as sponsor during data scraping (not in the calculation script itself)
- **Bill Supporters (賛成者)**: +5 points
- **Sponsoring Group Members (所属会派メンバー)**: +2 points
  - Members in the same parliamentary group as the sponsor on the submission date
  - If `bill_sponsor_groups` is set, uses that group directly
  - Otherwise, uses the sponsor's group from `member_group` with extended dates
  - Excludes bill sponsors (to avoid double counting)

#### Bill Voting (議案採決)

Voting is handled by **chamber**, regardless of the specific voting method (起立投票, 押しボタン, 記名投票, 異議なし採決).

**House of Representatives (衆議院) — Group-based voting**
- Points are applied to all members belonging to the parliamentary group that voted
- Uses extended group membership dates for accurate attribution
- **For (賛成)**: +2 points for each member in groups that voted yes
- **Against (反対)**: -2 points for each member in groups that voted no

**House of Councillors (参議院) — Individual-based voting**
- Based on individual member voting records from `bill_votes_result_member`
- **For (賛成)**: +5 points
- **Against (反対)**: -5 points

#### Zero-Score Filtering
Members with a score of 0 **and** no breakdown entries are excluded from the output. This means not all members appear in the JSON for every bill — only those who had some involvement.

## Usage

### Running the Calculation

#### Via Command Line
```bash
pnpm calculate:legislation
```

#### Via Web Interface (Admin Only)
1. Navigate to `/legislation-scores`
2. Click the "再計算" button (visible only to admins)
3. Confirm in the dialog
4. Progress is streamed via SSE (Server-Sent Events) with a progress bar
5. Page will automatically reload after completion

### Viewing Results

1. Visit `http://localhost:5173/legislation-scores` (or the port shown in your terminal)
2. Browse all legislation in a table
3. Use search to find specific bills by title
4. Use dropdown filters to narrow by bill type, session, or result status
5. Click on any bill row to see:
   - **Raw score histogram** showing member score distribution
   - **Normalized score histogram** showing distribution in [-1, 1] range
   - **Complete table** of all participating members (members with 0 score and no involvement are excluded)
   - Member name search within the modal
   - Detailed breakdown of how each member scored
   - Statistics (positive/negative/average/total participating members)

## Data Structure

### LegislationScore
```typescript
interface LegislationScore {
  billId: number;              // Bill ID
  billTitle: string;           // Bill title
  billType: string;            // Bill type (衆法/参法/閣法)
  billNumber: number;          // Bill number
  session: number;             // Diet session number (submissionSession)
  submissionDate: string | null; // Submission date
  result: string | null;       // Result (可決/否決/撤回/未了 or null)
  memberScores: MemberLegislationScore[]; // Participating member scores
  totalPositive: number;       // Count of positive scores
  totalNegative: number;       // Count of negative scores
  averageScore: number;        // Average score
}
```

### MemberLegislationScore
```typescript
interface MemberLegislationScore {
  memberId: number;            // Member ID
  memberName: string;          // Member name (primary name from names array)
  score: number;               // Total score for this legislation
  breakdown: string[];         // Explanation of score calculation
}
```

## Extended Group Membership Algorithm

The scoring system uses an extended group membership algorithm to handle gaps in official group records:

```typescript
function getExtendedGroupDates(memberId, group, allMemberGroups, memberParties, groupChamber) {
  // 1. Find member parties in the same chamber
  // 2. Find the party that contains the group's start date
  //    → Use party's start_date as extended start (bounded by previous group's end)
  // 3. Find the party that contains the group's end date
  //    → Use party's end_date as extended end (bounded by next group's start)
}
```

This ensures members are correctly attributed to groups even when:
- There are gaps between consecutive group records
- Party names change slightly between sessions
- Official records have incomplete date ranges

## Files

| File | Description |
|------|-------------|
| `/scripts/calculate_legislation_scores.ts` | Score calculation script |
| `/static/data/legislation_scores.json` | Generated JSON output |
| `/src/routes/api/calculate/+server.ts` | API endpoint for recalculation (admin-only, SSE) |
| `/src/routes/legislation-scores/+page.svelte` | UI component (client-side data loading) |
| `/src/routes/legislation-scores/+page.server.ts` | Server-side stub (returns empty array) |
| `/src/lib/server/legislation-score-index.ts` | Normalized score index for matching |
| `/src/routes/api/member-detail/+server.ts` | Member detail API (uses normalized scores) |

## API Endpoint

### POST `/api/calculate`

Triggers the legislation score calculation. **Admin-only** — returns 403 if the user is not an admin.

The response is a **Server-Sent Events (SSE) stream** that reports progress:

```
Content-Type: text/event-stream

data: {"progress": 5, "message": "500件の議案を処理中..."}
data: {"progress": 48, "message": "議案を処理中... (250/500)"}
data: {"progress": 95, "message": "データを保存中..."}
data: {"progress": 100, "message": "計算が完了しました！"}
data: {"done": true, "success": true}
```

On error:
```
data: {"done": true, "success": false, "error": "Process exited with code 1"}
```

## Performance Optimizations

The calculation script pre-loads all data from the database to minimize queries:

```typescript
// Data loaded upfront
- members, groups
- memberGroups, memberParties (for extended date calculation)
- billSponsors, billSponsorGroups, billSupporters
- billVotes, billVotesResultGroup, billVotesResultMember
```

This allows processing hundreds of bills efficiently with O(1) lookups per member/group.

## Development

### Adding New Features

1. **Modify calculation logic**: Edit `/scripts/calculate_legislation_scores.ts`
2. **Update UI**: Edit `/src/routes/legislation-scores/+page.svelte`
3. **Add filters/sorting**: Update the `sortedBills` derived state

### Testing

1. Start dev server: `pnpm dev`
2. Navigate to `http://localhost:5173/legislation-scores`
3. Test search, sorting, filtering (type/session/result), and modal functionality
4. As admin, click "再計算" to test calculation trigger with SSE progress

## Related Tables

The calculation uses data from these database tables:

| Table | Purpose |
|-------|---------|
| `member` | Member information (names array) |
| `group` | Parliamentary group information (with chamber) |
| `member_group` | Group membership with date ranges |
| `member_party` | Party membership with date ranges and chamber (for extended dates) |
| `bill` | Bill metadata (type, title, submissionDate, submissionSession, result) |
| `bill_sponsors` | Bill sponsor relationships |
| `bill_sponsor_groups` | Explicit sponsor group relationships |
| `bill_supporters` | Bill supporter relationships |
| `bill_votes` | Voting events per bill (chamber, votingMethod, votingDate) |
| `bill_votes_result_group` | Group voting results (used for 衆議院) |
| `bill_votes_result_member` | Individual voting results (used for 参議院) |

## Score Normalization

Raw scores are normalized to the range [-1, 1] for use in matching and clustering. The normalization is **per-bill** and **sign-preserving**, meaning a positive raw score always remains positive after normalization.

### Formula

```
if score > 0:  normalized = score / max(scores for this bill)   →  [0, 1]
if score < 0:  normalized = score / |min(scores for this bill)| →  [-1, 0]
if score == 0: normalized = 0
```

### Rationale

Not all bills have the same score range. For example:
- A bill with both submission and sangiin voting can have scores from -5 to +15
- A bill with only shugiin group voting might range from -2 to +12
- A bill with no voting record might only have 0 to +10

Using fixed global bounds (e.g., -5 to 15) would mean many bills never reach the full [-1, 1] range. Per-bill normalization ensures the strongest supporter of each bill maps to 1.0 and the strongest opponent maps to -1.0.

Sign preservation is also critical: a member who scored +2 (mildly supportive) should never be mapped to a negative normalized value just because the bill's range skews positive.

### Where normalization is applied

| File | Context |
|------|---------|
| `scripts/calculate_cluster_vectors.py` | Building member vectors for clustering |
| `src/lib/server/legislation-score-index.ts` | Serving normalized scores for matching |
| `src/routes/api/member-detail/+server.ts` | Including normalized scores in member detail API |
| `src/routes/legislation-scores/+page.svelte` | Normalized score distribution chart in modal |

## Performance Considerations

- The JSON file can be large (several MB) for many bills
- Members with zero score and no involvement are excluded from the JSON output, reducing file size
- Charts use histogram visualization (binned score distribution) for readability
- Data is loaded **client-side** via `fetch('/data/legislation_scores.json')` on mount
- The `+page.server.ts` returns an empty array (stub); all data comes from the static JSON
- Calculation script processes all bills and members efficiently with pre-loaded O(1) lookups
- Charts are dynamically created when modal opens and destroyed on close

## Future Enhancements

- [ ] Export functionality (CSV, PDF)
- [ ] Filter by date range
- [ ] Zoom/pan controls for chart
- [ ] Member comparison across multiple bills
- [ ] Time-series analysis
- [ ] Download chart as image
