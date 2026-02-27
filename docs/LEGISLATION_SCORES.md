# Legislation Scores Analysis

This module provides a comprehensive analysis of parliamentary members' scores for each piece of legislation.

## Overview

Instead of calculating a total score per member, this system calculates scores for **each legislation**, showing how all members voted or participated in that specific bill. The scores are used as input for the adaptive matching algorithm.

## Features

### 1. Legislation-Based Scoring
- Each bill shows all members' scores for that specific legislation
- View positive (supportive) and negative (opposing) members
- See average scores per legislation
- Visual bar chart showing score distribution

### 2. Interactive Web Interface
- **Location**: `/legislation-scores`
- Search bills by title
- Sort by various criteria (bill ID, positive count, negative count, average score)
- Click on any bill to see:
  - **Horizontal bar chart** with all members sorted by score
  - Complete table showing all members (not limited to top 20)
  - Color-coded visualization (green=positive, red=negative, gray=zero)
  - Detailed score breakdowns in tooltips and table
- Button to recalculate scores

### 3. Score Calculation Logic

The calculation uses **extended group membership dates** for accurate attribution. This means:
- Group membership dates are extended using `member_party` records
- A member's effective group membership spans from their party start date to the next group's start date
- This handles gaps between official group records

#### Bill Submission (議案提出)
- **Bill Sponsor (議案提出者)**: +10 points
  - Can be multiple members
  - For Cabinet Bills (閣法), the Prime Minister (内閣総理大臣) at the time of submission is the sponsor
- **Bill Supporters (賛成者)**: +5 points
- **Sponsoring Group Members (所属会派メンバー)**: +2 points
  - Members in the same parliamentary group as the sponsor on the submission date
  - If `bill_sponsor_groups` is set, uses that group directly
  - Otherwise, uses the sponsor's group from `member_group` with extended dates
  - Excludes bill sponsors and supporters (to avoid double counting)

#### Bill Voting (議案採決)

**House of Representatives (衆議院) - Standing Vote (起立投票)**
- Points are applied to all members belonging to the parliamentary group that voted
- Uses extended group membership dates for accurate attribution
- **For (賛成)**: +2 points for each member in groups that voted yes
- **Against (反対)**: -2 points for each member in groups that voted no

**House of Councillors (参議院) - Push-button Voting (押しボタン式投票)**
- Based on individual member voting records from `bill_votes_result_member`
- **For (賛成)**: +5 points
- **Against (反対)**: -5 points

**Note**: Other voting methods (記名投票, etc.) are not yet implemented.

## Usage

### Running the Calculation

#### Via Command Line
```bash
pnpm calculate:legislation
```

#### Via Web Interface
1. Navigate to `/legislation-scores`
2. Click the "スコアを再計算" (Recalculate Scores) button
3. Wait for the calculation to complete
4. Page will automatically reload with new data

### Viewing Results

1. Visit `http://localhost:5173/legislation-scores` (or the port shown in your terminal)
2. Browse all legislation in card format
3. Use search to find specific bills
4. Click on any bill card to see:
   - **Bar chart visualization** showing all members' scores
   - **Complete table** with all members (not just top 20)
   - Detailed breakdown of how each member scored
   - Statistics (positive/negative/average/total members)

## Data Structure

### LegislationScore
```typescript
interface LegislationScore {
  billId: number;              // Bill ID
  billTitle: string;           // Bill title
  billType: string;            // Bill type (衆法/参法/閣法)
  billNumber: number;          // Bill number
  session: number;             // Diet session number
  submissionDate: string | null; // Submission date
  memberScores: MemberLegislationScore[]; // All member scores
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
| `/src/routes/api/calculate/+server.ts` | API endpoint for recalculation |
| `/src/routes/legislation-scores/+page.svelte` | UI component |
| `/src/routes/legislation-scores/+page.server.ts` | Server-side data loading |

## API Endpoint

### POST `/api/calculate`

Triggers the legislation score calculation.

**Response:**
```json
{
  "success": true,
  "message": "Calculation completed successfully",
  "output": "..."
}
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
3. Test search, sorting, and modal functionality
4. Click "スコアを再計算" to test calculation trigger

## Related Tables

The calculation uses data from these database tables:

| Table | Purpose |
|-------|---------|
| `member` | Member information |
| `group` | Parliamentary group information (with chamber) |
| `member_group` | Group membership with date ranges |
| `member_party` | Party membership with date ranges (for extended dates) |
| `bill_sponsors` | Bill sponsor relationships |
| `bill_sponsor_groups` | Explicit sponsor group relationships |
| `bill_supporters` | Bill supporter relationships |
| `bill_votes` | Voting events per bill |
| `bill_votes_result_group` | Group voting results (衆議院) |
| `bill_votes_result_member` | Individual voting results (参議院) |

## Performance Considerations

- The JSON file can be large (several MB) for many bills
- All members are shown in both chart and table (no artificial limit)
- Chart uses horizontal bars for better readability with many members
- Data is loaded server-side to avoid large client-side downloads
- Calculation script processes all bills and members efficiently
- Chart is dynamically created when modal opens and destroyed on close

## Future Enhancements

- [ ] Additional chart types (line charts, pie charts)
- [ ] Export functionality (CSV, PDF)
- [ ] Filter by date range
- [ ] Filter by bill type
- [ ] Zoom/pan controls for chart
- [ ] Member comparison across multiple bills
- [ ] Time-series analysis
- [ ] Download chart as image
