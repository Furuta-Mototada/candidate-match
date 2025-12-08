# Legislation Scores Analysis

This module provides a comprehensive analysis of parliamentary members' scores for each piece of legislation.

## Overview

Instead of calculating a total score per member, this system calculates scores for **each legislation**, showing how all members voted or participated in that specific bill.

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

#### Bill Submission (議案提出)
- **Bill Sponsor (議案提出者)**: +10 points
  - Can be multiple members
  - For Cabinet Bills (閣法), the Prime Minister (内閣総理大臣) at the time of submission is set as the sponsor
- **Bill Supporters (賛成者)**: +5 points
- **Sponsoring Group Members (所属会派メンバー)**: +2 points
  - Members in the same parliamentary group as the sponsor on the submission date
  - Excludes bill sponsors and supporters (to avoid double counting)

#### Bill Voting (議案採決)

**House of Representatives (衆議院) - Standing Vote (起立投票)**
- Points are applied to all members belonging to the parliamentary group that voted
- **For (賛成)**: +2 points for each member in groups that voted yes
- **Against (反対)**: -2 points for each member in groups that voted no

**House of Councillors (参議院) - Push-button Voting (押しボタン式投票)**
- Based on individual member voting records
- **For (賛成)**: +5 points
- **Against (反対)**: -5 points

**Note**: Other voting methods (記名投票, etc.) are not yet implemented.

## Usage

### Running the Calculation

#### Via Command Line
```bash
npm run calculate:legislation
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
  memberName: string;          // Member name
  score: number;               // Total score for this legislation
  breakdown: string[];         // Explanation of score calculation
}
```

## Files

- **Script**: `/scripts/calculate_legislation_scores.ts`
- **Data Output**: `/src/lib/data/legislation_scores.json`
- **API Endpoint**: `/src/routes/api/calculate/+server.ts`
- **Page**: `/src/routes/legislation-scores/+page.svelte`
- **Server Load**: `/src/routes/legislation-scores/+page.server.ts`

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

## Development

### Adding New Features

1. **Modify calculation logic**: Edit `/scripts/calculate_legislation_scores.ts`
2. **Update UI**: Edit `/src/routes/legislation-scores/+page.svelte`
3. **Add filters/sorting**: Update the `sortedBills` derived state

### Testing

1. Start dev server: `npm run dev`
2. Navigate to `http://localhost:5173/legislation-scores`
3. Test search, sorting, and modal functionality
4. Click "スコアを再計算" to test calculation trigger

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
