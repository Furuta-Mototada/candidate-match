# Bill Enrichment Data Pipeline

This document explains the data scraping and enrichment pipeline for collecting debate records and generating bill summaries.

## Overview

The enrichment pipeline has three main components:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ scrape_debates  │───▶│  enrich_bills    │───▶│ Bill Enrichment │
│ (hourei.ndl.go) │    │   (OpenAI LLM)   │    │   API Endpoint  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                      │                       │
         ▼                      ▼                       ▼
   bill_debates          bill_enrichment         EnrichedBillCard
      table                  table                 Component
```

## 1. Debate Scraping (`scrape_debates.ts`)

### Purpose
Fetches debate records from the National Diet (国会) proceedings to understand how each bill was discussed in parliament.

### Data Sources
1. **hourei.ndl.go.jp** (日本法令索引) - Provides authoritative 審議経過 (deliberation history) with exact meeting links
2. **Kokkai NDL API** - Fetches speech content for each meeting

### Why hourei.ndl.go.jp?

Previous approaches (keyword search, committee-based search) could return irrelevant results:
- Keyword search might find meetings that mention a bill name but aren't actually discussing that bill
- Committee search might find meetings where the committee discussed other unrelated topics

The hourei.ndl.go.jp approach is more accurate because it provides the **exact list of meetings** where each bill was formally discussed, as recorded in the official legislative index.

### How It Works

```
┌─────────────────────┐
│    For each Bill    │
│  (from bill table)  │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Search hourei.ndl   │  ← Playwright scrapes hourei.ndl.go.jp
│ by bill title       │     to find the bill's page
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Extract 審議経過    │  ← The page lists all deliberation records
│ (deliberation list) │     with kokkai.ndl.go.jp URLs
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ For each meeting:   │  ← Use Kokkai API to fetch full speeches
│ Fetch speeches via  │     /api/speech?issueID=...
│ Kokkai API          │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Save to bill_debates│
│ table               │
└─────────────────────┘
```

### Usage

```bash
# Process all bills (be patient - uses Playwright)
pnpm scrape:debates

# Process 10 bills
pnpm scrape:debates --limit 10

# Skip bills that already have debates
pnpm scrape:debates --skip-existing

# Process a specific bill
pnpm scrape:debates --bill-id=123

# Verbose output
pnpm scrape:debates --limit 5 --verbose
```

### Output
Data is stored in the `bill_debates` table with:
- Meeting information (name, date, house, session)
- Speaker information (name, group, position)
- Full speech content
- Speech URL linking to original source

---

## 2. Bill Enrichment (`enrich_bills.py`)

### Purpose
Generates LLM-powered summaries and analysis for each bill to help users understand complex legislation.

### Data Source
- **API**: OpenAI GPT-4o
- **Input**: Bill title, description, and scraped debate records

### What It Generates

| Field | Description | Example |
|-------|-------------|---------|
| `summary_short` | One-line summary | 「フロンガスの回収義務を強化し、違反時の罰則を引き上げる」 |
| `summary_detailed` | Plain-language explanation | 2-3 paragraphs explaining the bill's purpose and mechanisms |
| `key_points` | Who/What/When | JSON with `who`, `what`, `when` fields |
| `impact_tags` | Affected groups | `["#中小企業", "#環境保護", "#設備業者"]` |
| `pros_and_cons` | Both sides | Arguments for and against the bill |
| `example_scenario` | Real-world example | How this affects a typical citizen/business |

### Usage

```bash
# Process 10 bills
pnpm enrich:bills --limit 10

# Skip already enriched bills
pnpm enrich:bills --limit 50 --skip-existing
```

### Requirements
- `OPENAI_API_KEY` environment variable

---

## 3. e-Gov Law Lookup (`lookup_egov_laws.ts`)

### Purpose
Links enacted bills to their official law IDs in the e-Gov database.

### Data Source
- **API**: [e-Gov Law API v2](https://laws.e-gov.go.jp/api/2/swagger-ui/)

### What It Provides
For enacted bills (passed=true):
- Official law ID (法令ID)
- Law number (法令番号)
- Promulgation date
- Link to full law text

### Usage

```bash
pnpm lookup:egov --limit 10 --verbose
```

---

## Database Schema

### `bill_debates` Table
```sql
CREATE TABLE bill_debates (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER REFERENCES bill(id),
  meeting_id TEXT NOT NULL,           -- Kokkai API meeting ID
  speech_id TEXT UNIQUE NOT NULL,     -- Kokkai API speech ID
  session INTEGER NOT NULL,           -- Diet session number
  house TEXT NOT NULL,                -- 参議院/衆議院
  meeting_name TEXT NOT NULL,         -- e.g., "環境委員会"
  issue_number TEXT,                  -- Meeting issue number
  meeting_date TEXT,                  -- YYYY-MM-DD
  speaker_name TEXT NOT NULL,
  speaker_group TEXT,                 -- Political party
  speaker_position TEXT,              -- e.g., "環境大臣"
  speaker_role TEXT,                  -- 証人/参考人/公述人
  speech_order INTEGER NOT NULL,
  speech_content TEXT NOT NULL,       -- Full speech text
  speech_url TEXT,
  speech_type TEXT,                   -- government/question/pro/con/etc.
  created_at TIMESTAMP DEFAULT NOW()
);
```

### `bill_enrichment` Table
```sql
CREATE TABLE bill_enrichment (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER UNIQUE REFERENCES bill(id),
  status enrichment_status DEFAULT 'pending',
  summary_short TEXT,
  summary_detailed TEXT,
  key_points JSONB,                   -- {who, what, when}
  impact_tags JSONB,                  -- ["#tag1", "#tag2"]
  pros_and_cons JSONB,                -- {pro: [...], con: [...]}
  example_scenario TEXT,
  source_context TEXT,                -- Input used for generation
  model_used TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### GET `/api/bill-enrichment?billId=123`
Returns enriched data for a single bill.

### POST `/api/bill-enrichment`
Batch fetch enriched data for multiple bills.

**Request:**
```json
{ "billIds": [123, 456, 789] }
```

**Response:**
```json
{
  "123": {
    "enrichment": { ... },
    "debates": [ ... ],
    "voteResults": [ ... ]
  }
}
```

---

## UI Component

The `EnrichedBillCard` component displays enrichment data with 3 progressive detail levels:

| Level | Content |
|-------|---------|
| 1 (Basic) | Short summary + impact tags |
| 2 (Expanded) | + Detailed summary, key points, pros/cons, example |
| 3 (Full) | + Vote results by party, debate excerpts, PDF link |

---

## Complete Enrichment Pipeline

To fully enrich bills for the matching feature:

```bash
# 1. Scrape debate records (can take a while due to rate limits)
pnpm scrape:debates --limit 100 --skip-existing

# 2. Generate LLM enrichments
pnpm enrich:bills --limit 100 --skip-existing

# 3. (Optional) Look up e-Gov law references
pnpm lookup:egov --limit 100
```

---

## Rate Limits & Considerations

| API | Rate Limit | Notes |
|-----|------------|-------|
| Kokkai NDL | 3s between requests | Be respectful, they ask for this |
| OpenAI | Token-based | ~$0.01-0.05 per bill |
| e-Gov | No specific limit | But be reasonable |

---

## Troubleshooting

### No debates found for a bill
- The bill may not have been discussed yet
- The title extraction may not be finding good search terms
- Try checking the Kokkai website manually

### e-Gov not finding enacted laws
- Amendment bills (改正法) may not be cataloged separately
- The script finds the base law being amended, not the amendment itself

### LLM enrichment failing
- Check `OPENAI_API_KEY` is set
- Check rate limits
- Bills without description may produce lower quality results
