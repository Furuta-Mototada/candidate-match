# Bill Enrichment Data Pipeline

This document explains the data scraping and enrichment pipeline for collecting debate records and generating bill summaries.

## Overview

The enrichment pipeline has three main components:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ scrape_debates  │───▶│ summarize_debates│───▶│  enrich_bills   │
│ (hourei.ndl.go) │    │   (OpenAI LLM)   │    │   (OpenAI LLM)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                      │                       │
         ▼                      ▼                       ▼
   bill_debates          bill_debate_summary      bill_enrichment
      table                   table                  table
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
│ Search hourei.ndl   │  ← Uses session/type/number for precise matching
│ by bill identifiers │     (e.g., 第215回 閣法 第1号)
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
│ Kokkai API          │     with full pagination
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

# Dry run (no database writes)
pnpm scrape:debates --dry-run
```

### Output
Data is stored in the `bill_debates` table with:
- Meeting information (name, date, house, session)
- Speaker information (name, group, position)
- Full speech content
- Speech URL linking to original source

---

## 2. Debate Summarization (`summarize_debates.py`)

### Purpose
Processes raw debate speeches into structured summaries using LLM, extracting key arguments and positions.

### Data Source
- **Input**: `bill_debates` table (raw speeches)
- **API**: OpenAI GPT-5.2 (400K context window)
- **Output**: `bill_debate_summary` table

### What It Generates

| Field | Description |
|-------|-------------|
| `pro_arguments_summary` | JSON array of pro arguments from supporters |
| `con_arguments_summary` | JSON array of con arguments from opponents |
| `key_questions` | Important questions raised by members |
| `government_explanations` | Key explanations from ministers/government |
| `debate_count` | Number of speeches processed |

### Algorithm

For bills with many speeches (100+), uses **hierarchical summarization**:
1. Split speeches into chunks of ~100 speeches
2. Summarize each chunk separately
3. Merge chunk summaries into final summary

### Usage

```bash
# Process 10 bills with most debates
pnpm summarize:debates --limit 10

# Process a specific bill
pnpm summarize:debates --bill-id 1427

# Force regenerate even if summary exists
pnpm summarize:debates --bill-id 1427 --force

# Process in parallel (3 workers)
pnpm summarize:debates --limit 50 --concurrency 3
```

---

## 3. Bill Enrichment (`enrich_bills.py`)

## 3. Bill Enrichment (`enrich_bills.py`)

### Purpose
Generates LLM-powered summaries and analysis for each bill to help users understand complex legislation.

### Data Sources
- **Bill text**: From `bill_embeddings.text_content` (PDF extracted text)
- **Debate summary**: From `bill_debate_summary` table
- **API**: OpenAI GPT-5.2 (400K context, 128K output)

### What It Generates

| Field | Description | Example |
|-------|-------------|---------|
| `summary_short` | One-line summary (50-80 chars) | 「フロンガスの回収義務を強化し、違反時の罰則を引き上げる」 |
| `summary_detailed` | Plain-language explanation (200-300 chars) | High school level explanation of bill's purpose |
| `key_points` | Who/What/When | JSON array with impact details |
| `impact_tags` | Affected groups | `["#中小企業", "#環境保護", "#設備業者"]` |
| `pros_and_cons` | Both sides | Arguments for and against (from debate analysis) |
| `example_scenario` | Real-world example | How this affects a typical citizen/business |

### Usage

```bash
# Process 10 bills (prioritizes bills with debates)
pnpm enrich:bills --limit 10

# Process a specific bill
pnpm enrich:bills --bill-id 1427

# Force regenerate even if enrichment exists
pnpm enrich:bills --bill-id 1427 --force

# Process in parallel (3 workers)
pnpm enrich:bills --limit 50 --concurrency 3
```

### How It Works

1. Prioritizes bills with more debate data and PDF text
2. Loads debate summary (pro/con arguments, key questions)
3. Constructs prompt with bill title, PDF text (up to 100K chars), and debate summary
4. Generates neutral, factual enrichment content
5. Stores with source hash for change detection

### Requirements
- `OPENAI_API_KEY` environment variable

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

### `bill_debate_summary` Table
```sql
CREATE TABLE bill_debate_summary (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER UNIQUE REFERENCES bill(id),
  status TEXT DEFAULT 'pending',      -- pending/processing/completed/failed
  pro_arguments_summary TEXT,         -- JSON array of pro arguments
  con_arguments_summary TEXT,         -- JSON array of con arguments
  key_questions TEXT,                 -- JSON array of key questions
  government_explanations TEXT,       -- JSON array of gov explanations
  debate_count INTEGER,               -- Number of speeches processed
  llm_model TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### `bill_enrichment` Table
```sql
CREATE TABLE bill_enrichment (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER UNIQUE REFERENCES bill(id),
  status TEXT DEFAULT 'pending',      -- pending/processing/completed/failed
  summary_short TEXT,
  summary_detailed TEXT,
  key_points JSONB,                   -- [{who, what, when}, ...]
  impact_tags JSONB,                  -- ["#tag1", "#tag2"]
  pros_and_cons JSONB,                -- {pros: [...], cons: [...]}
  example_scenario TEXT,
  source_text_hash TEXT,              -- MD5 hash for change detection
  llm_model TEXT,
  error_message TEXT,
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

# 2. Summarize debates (requires OPENAI_API_KEY)
pnpm summarize:debates --limit 100 --concurrency 3

# 3. Generate LLM enrichments (uses debate summaries + PDF text)
pnpm enrich:bills --limit 100 --concurrency 3
```

---

## Rate Limits & Considerations

| API | Rate Limit | Notes |
|-----|------------|-------|
| Kokkai NDL | 2s between requests | Conservative rate limiting |
| hourei.ndl.go.jp | Playwright browser | Sequential page loads |
| OpenAI | Token-based | ~$0.01-0.05 per bill for enrichment |

---

## Troubleshooting

### No debates found for a bill
- The bill may not have been discussed yet
- Try checking hourei.ndl.go.jp manually with session/type/number
- Some bills are passed without committee discussion

### Debate summarization producing poor results
- Check that bill has sufficient debates (`debate_count > 0`)
- Very short debates may produce minimal summaries

### LLM enrichment failing
- Check `OPENAI_API_KEY` is set
- Check rate limits
- Bills without PDF text or description may produce lower quality results
