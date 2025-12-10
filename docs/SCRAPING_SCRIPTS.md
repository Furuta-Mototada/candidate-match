# Scraping Scripts Documentation

This document describes all the scraping algorithms used in the candidate-match project, their purposes, data sources, and the command-line parameters they accept.

## Table of Contents

- [scrape_kantei.ts](#scrape_kanteits)
- [scrape_sangiin.ts](#scrape_sangiints)
- [scrape_shugiin.ts](#scrape_shugiints)
- [scrape_debates.ts](#scrape_debatests)
- [scrape_member_groups.ts](#scrape_member_groupsts)

---

## scrape_kantei.ts

### Purpose

Scrapes historical cabinet (Prime Minister) information from the Prime Minister's Office website (kantei.go.jp). It collects data about past Prime Ministers from the 90th cabinet onwards, including their names and terms of office.

### Data Source

- **Main URL**: `https://www.kantei.go.jp/jp/rekidainaikaku/index.html`
- **Detail pages**: Individual cabinet member pages linked from the main index

### What It Scrapes

- Prime Minister names
- Cabinet start dates
- Cabinet end dates (null if currently serving)

### Database Tables Updated

- `member` - Creates member records for Prime Ministers
- `cabinet` - Stores cabinet tenure information (member ID, start date, end date)

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Runs without writing to the database. Outputs what would be inserted/updated. |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Normal run - scrapes and saves to database
pnpm tsx scripts/scrape_kantei.ts

# Dry run - preview what would be scraped without DB writes
pnpm tsx scripts/scrape_kantei.ts --dry-run
```

---

## scrape_sangiin.ts

### Purpose

Scrapes bill information from the House of Councillors (Sangiin) website. This is the **primary bill scraping script** that creates bill records and should be run before `scrape_shugiin.ts`. It handles:

- Bill metadata (type, session, number, title)
- Submission dates
- Deliberation status (completed/ongoing, passed/failed)
- Committee assignments
- Voting records (including individual push-button votes)

### Data Source

- **Base URL**: `https://www.sangiin.go.jp`
- **Session pages**: `https://www.sangiin.go.jp/japanese/joho1/kousei/gian/{session}/gian.htm`
- **Bill detail pages**: Linked from session pages
- **Vote result pages**: Linked from bill detail pages (for push-button voting)

### What It Scrapes

- **閣法** (Cabinet bills)
- **衆法** (House of Representatives bills)
- **参法** (House of Councillors bills)

For each bill:
- Bill type, session, and number
- Bill title
- Submission date
- Deliberation completion status
- Pass/fail status
- Committee assignments (both chambers)
- Voting methods and dates
- Individual vote results (for push-button voting)

### Database Tables Updated

- `bill` - Main bill records
- `bill_detail` - Bill titles
- `committee` - Committee records
- `committee_bill` - Bill-committee assignments
- `bill_votes` - Voting records
- `bill_votes_result_member` - Individual member vote results
- `member` - Member records (for voters)
- `bill_sponsors` - Cabinet bill sponsors (links to Prime Minister)

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Runs without writing to the database |
| `[startSession]` | Positional (1st) | No | 198 | First Diet session number to process |
| `[endSession]` | Positional (2nd) | No | 219 | Last Diet session number to process |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Scrape all sessions from 198 to 219 (default)
pnpm tsx scripts/scrape_sangiin.ts

# Scrape a specific session range
pnpm tsx scripts/scrape_sangiin.ts 213 215

# Scrape only session 215
pnpm tsx scripts/scrape_sangiin.ts 215 215

# Dry run for a specific session
pnpm tsx scripts/scrape_sangiin.ts --dry-run 215 215
```

### Notes

- **Run this script first** before `scrape_shugiin.ts` as it creates the base bill records
- Handles special deliberation status cases:
  - 撤回 (withdrawn) in remarks
  - 否決 (rejected) at plenary sessions
  - 未了 (incomplete) when both plenary sessions are empty

---

## scrape_shugiin.ts

### Purpose

Scrapes additional bill information from the House of Representatives (Shugiin) website. This script **supplements** the data collected by `scrape_sangiin.ts` by adding:

- Bill sponsors (議案提出者一覧)
- Sponsor groups (議案提出会派)
- Bill supporters (議案提出の賛成者)
- Voting group results (approval/rejection by party)

### Data Source

- **Base URL**: `https://www.shugiin.go.jp`
- **Session pages**: `https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/kaiji{session}.htm`
- **Bill detail pages**: Linked from session pages
- **Kokkai API**: `https://kokkai.ndl.go.jp/api/meeting` (for committee chair lookup)

### What It Scrapes

For 衆法 (House of Representatives bills):
- Sponsors from 議案提出者一覧
- Sponsor groups from 議案提出会派
- Supporters from 議案提出の賛成者

For 参法 (House of Councillors bills):
- Sponsors (including committee chair resolution via Kokkai API)

For all bill types:
- Voting group approvals (衆議院審議時賛成会派)
- Voting group rejections (衆議院審議時反対会派)

### Database Tables Updated

- `member` - Member records (for sponsors/supporters)
- `group` - Political group records
- `bill_sponsors` - Bill sponsor relationships
- `bill_sponsor_groups` - Bill sponsor group relationships
- `bill_supporters` - Bill supporter relationships
- `bill_votes_result_group` - Group voting results

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Runs without writing to the database |
| `[startSession]` | Positional (1st) | No | 213 | First Diet session number to process |
| `[endSession]` | Positional (2nd) | No | 219 | Last Diet session number to process |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Scrape sessions 213-219 (default)
pnpm tsx scripts/scrape_shugiin.ts

# Scrape a specific session range
pnpm tsx scripts/scrape_shugiin.ts 215 218

# Dry run
pnpm tsx scripts/scrape_shugiin.ts --dry-run 215 215
```

### Dependencies

- **Requires**: Bills must exist in database first (run `scrape_sangiin.ts` first)
- Uses the Kokkai API for committee chair name resolution

---

## scrape_debates.ts

### Purpose

Scrapes debate records (speech content) for bills from the National Diet Library. It finds deliberation records for each bill and fetches the full speech content from Diet proceedings.

### Data Sources

- **Hourei NDL**: `https://hourei.ndl.go.jp` - For finding bill deliberation history
- **Kokkai API**: `https://kokkai.ndl.go.jp/api/speech` - For fetching speech content

### What It Scrapes

For each bill:
- Deliberation meetings (plenary sessions, committee meetings)
- Individual speeches from each meeting:
  - Speaker name
  - Speaker group/party
  - Speaker position/role
  - Speech content (full text)
  - Meeting metadata (date, house, committee, issue number)

### Database Tables Updated

- `bill_debates` - Speech records for each bill

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--limit=N` | Named | No | ∞ | Maximum number of bills to process |
| `--skip-existing` | Flag | No | - | Skip bills that already have debate records |
| `--verbose` | Flag | No | - | Enable verbose logging |
| `--bill-id=N` | Named | No | - | Process only a specific bill by ID |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |

### Usage Examples

```bash
# Process all bills (with rate limiting)
pnpm tsx scripts/scrape_debates.ts

# Process first 10 bills that don't have debates yet
pnpm tsx scripts/scrape_debates.ts --limit=10 --skip-existing

# Process a specific bill with verbose output
pnpm tsx scripts/scrape_debates.ts --bill-id=42 --verbose

# Combine options
pnpm tsx scripts/scrape_debates.ts --limit=5 --skip-existing --verbose
```

### Technical Notes

- Uses **Playwright** for browser automation (headless Chromium)
- Implements rate limiting:
  - 500ms delay between API requests
  - 1000ms delay between bills
- Handles multiple pages of search results from hourei.ndl.go.jp
- Parses multiple URL formats from the Kokkai API

### Dependencies

- **Requires**: Bills must exist in database with titles (`bill` and `bill_detail` tables)
- **Browser**: Uses Playwright with Chromium

---

## scrape_member_groups.ts

### Purpose

Scrapes political group (party) affiliation history for Diet members by analyzing their speech records from the Kokkai API. It determines when a member was affiliated with each group based on their speeches.

### Data Source

- **Kokkai API**: `https://kokkai.ndl.go.jp/api/speech`

### What It Scrapes

For each member in the database:
- Searches all speeches within the date range
- Extracts the `speakerGroup` field from each speech
- Computes date ranges for each group affiliation
- Merges overlapping or adjacent periods (within 30 days)

### Database Tables Updated

- `group` - Political group/party records
- `member_group` - Member-group affiliation records with date ranges

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Runs without writing to the database |
| `[fromDate]` | Positional (1st) | No | 1947-01-01 | Start date for speech search (YYYY-MM-DD) |
| `[untilDate]` | Positional (2nd) | No | Today | End date for speech search (YYYY-MM-DD) |
| `[memberId]` | Positional (3rd) | No | All | Process only a specific member by ID |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Process all members from 1947 to today
pnpm tsx scripts/scrape_member_groups.ts

# Process members with speeches from 2020 onwards
pnpm tsx scripts/scrape_member_groups.ts 2020-01-01

# Process a specific date range
pnpm tsx scripts/scrape_member_groups.ts 2015-01-01 2020-12-31

# Process only a specific member
pnpm tsx scripts/scrape_member_groups.ts 1947-01-01 2025-01-01 42

# Dry run
pnpm tsx scripts/scrape_member_groups.ts --dry-run
```

### Technical Notes

- Implements **3 second delay** between API requests (as recommended by Kokkai API documentation)
- Fetches up to 100 speeches per API request
- Paginates through all speech records for each member
- Automatically merges overlapping group affiliations

### Dependencies

- **Requires**: Members must exist in database first (populated by other scraping scripts)

---

## Recommended Execution Order

For a complete data refresh, run the scripts in this order:

1. **`scrape_kantei.ts`** - Populates Prime Minister records
2. **`scrape_sangiin.ts`** - Creates bill records and basic metadata
3. **`scrape_shugiin.ts`** - Adds sponsors and voting group data
4. **`scrape_member_groups.ts`** - Populates party affiliation history
5. **`scrape_debates.ts`** - Fetches debate speech content

```bash
# Full refresh example
pnpm tsx scripts/scrape_kantei.ts
pnpm tsx scripts/scrape_sangiin.ts
pnpm tsx scripts/scrape_shugiin.ts
pnpm tsx scripts/scrape_member_groups.ts
pnpm tsx scripts/scrape_debates.ts --skip-existing
```

## Common Environment Setup

All scripts require a PostgreSQL database connection. Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/candidate_match
```

## Rate Limiting

All scripts implement rate limiting to be respectful to the data sources:

| Script | Delay | Notes |
|--------|-------|-------|
| scrape_kantei.ts | None | Low volume, single page |
| scrape_sangiin.ts | None | Sequential requests |
| scrape_shugiin.ts | None | Sequential requests |
| scrape_debates.ts | 500ms-1000ms | High volume API |
| scrape_member_groups.ts | 3000ms | Per API documentation |
