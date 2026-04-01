# Scraping Scripts Documentation

This document describes all the scraping algorithms used in the candidate-match project, their purposes, data sources, and the command-line parameters they accept.

> **Note**: `scrape_debates.ts` is documented in [BILL_ENRICHMENT.md](BILL_ENRICHMENT.md).

## Table of Contents

- [scrape_sessions.ts](#scrape_sessionsts)
- [scrape_kokkai_members.ts](#scrape_kokkai_membersts)
- [scrape_sangiin_27.ts](#scrape_sangiin_27ts)
- [scrape_shugiin_51.ts](#scrape_shugiin_51ts)
- [scrape_kantei.ts](#scrape_kanteits)
- [scrape_sangiin.ts](#scrape_sangiints)
- [fix_scrape_sangiin.ts](#fix_scrape_sangiints)
- [scrape_shugiin.ts](#scrape_shugiints)
- [fix_scrape_shugiin.ts](#fix_scrape_shugiints)
- [scrape_member_groups.ts](#scrape_member_groupsts)
- [check_data_integrity.ts](#check_data_integrityts)

---

## scrape_sessions.ts

### Purpose

Scrapes Diet session information from the House of Representatives website. This provides the official session numbers, types, and date ranges.

### Data Source

- **URL**: `https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/kaiki.htm`

### What It Scrapes

- Session number (回)
- Session type (常会/臨時会/特別会)
- Start date
- End date (may include dissolution notes)

### Database Tables Updated

- `congress_session` - Session records with dates

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Preview without database writes |

### Usage Examples

```bash
# Scrape all sessions
pnpm scrape:sessions

# Dry run
pnpm scrape:sessions --dry-run
```

---

## scrape_kokkai_members.ts

### Purpose

Scrapes Diet member information from 国会議員白書 (kokkai.sugawarataku.net) for historical terms, and from official Diet websites for the latest terms. It collects member names, party affiliations, and districts.

For the latest terms not yet available on 国会議員白書, it delegates to dedicated sub-scrapers:
- **衆議院 51期** → `scrape_shugiin_51.ts`
- **参議院 27期** → `scrape_sangiin_27.ts`

### Data Sources

- **Primary**: `https://kokkai.sugawarataku.net/` (国会議員白書) — 衆議院 23–50期, 参議院 1–26期
- **衆議院 51期**: `https://www.shugiin.go.jp/` (via `scrape_shugiin_51.ts`)
- **参議院 27期**: `https://www.sangiin.go.jp/` (via `scrape_sangiin_27.ts`)

### What It Scrapes

For each Diet term:
- Member names (including alternate readings)
- Party affiliation
- Electoral district
- Number of elections won
- Profile URL

### Database Tables Updated

- `member` - Member records with name variations (stored as `names` array)
- `party` - Political party records
- `member_party` - Member-party affiliations with date ranges and chamber

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Parse pages without database writes |
| `--shugiin` | Flag | No | - | Only scrape 衆議院 |
| `--sangiin` | Flag | No | - | Only scrape 参議院 |
| `[start_term]` | Positional (1st) | No | 23 (衆) / 1 (参) | First term to process |
| `[end_term]` | Positional (2nd) | No | 51 (衆) / 27 (参) | Last term to process |

### Usage Examples

```bash
# Scrape all terms for both houses
pnpm scrape:members

# Scrape only 衆議院 terms 45-51
pnpm scrape:members --shugiin 45 51

# Scrape only 参議院 terms 20-27
pnpm scrape:members --sangiin 20 27

# Dry run
pnpm scrape:members --dry-run
```

---

## scrape_sangiin_27.ts

### Purpose

Scrapes 参議院 27期 member information. This term started 2025-07-20 and is not yet available on 国会議員白書, so it scrapes directly from sangiin.go.jp and Wikipedia.

This script is called automatically by `scrape_kokkai_members.ts` when the requested range includes term 27, but can also be run standalone.

### Data Sources

- **Member list**: `https://www.sangiin.go.jp/japanese/joho1/kousei/giin/219/giin.htm`
- **Party info**: Wikipedia `第27回参議院議員通常選挙` page (mapped by CSS background color)

### What It Scrapes

- Member names for both Term 26 (still serving) and Term 27
- Party affiliation (Term 26 from existing DB records, Term 27 from Wikipedia)
- Term start/end dates

### Database Tables Updated

- `member` - Member records
- `party` - Political party records
- `member_party` - Member-party affiliations

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Preview without database writes |
| `--verbose` | Flag | No | - | Enable detailed logging |

### Notes

- Uses hardcoded `NAME_ALIASES` for members whose names differ between sangiin.go.jp and Wikipedia
- Requires `DATABASE_URL` even in dry-run mode (to fetch Term 26 party data from DB)

---

## scrape_shugiin_51.ts

### Purpose

Scrapes 衆議院 51期 member information. This term started 2026-02-08 and is not yet available on 国会議員白書, so it scrapes directly from shugiin.go.jp and Wikipedia.

This script is called automatically by `scrape_kokkai_members.ts` when the requested range includes term 51, but can also be run standalone.

### Data Sources

- **Member list**: `https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/syu/{N}giin.htm` (paginated あ行–わ行, Shift-JIS)
- **Party info**: Wikipedia `第51回衆議院議員総選挙` page (mapped by CSS background color)

> **Note**: shugiin.go.jp shows 会派 (caucus), NOT 政党 (party) — party comes from Wikipedia only.

### What It Scrapes

- Member names
- Party affiliation (from Wikipedia)
- Term start/end dates

### Database Tables Updated

- `member` - Member records
- `party` - Political party records
- `member_party` - Member-party affiliations

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Preview without database writes |
| `--verbose` | Flag | No | - | Enable detailed logging |

### Notes

- Uses extensive `NAME_ALIASES` mapping (23+ entries) for names differing between shugiin.go.jp and Wikipedia (hiragana vs kanji, simplified vs traditional kanji)

---

## scrape_kantei.ts

### Purpose

Scrapes historical cabinet (Prime Minister) information from the Prime Minister's Office website (kantei.go.jp). It collects data about past Prime Ministers including their names and terms of office.

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
| `--dry-run` | Flag | No | - | Runs without writing to the database |
| `--min-cabinet=N` | Named | No | 43 | Only process cabinets from 第N代 onwards |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Normal run - scrapes from 第43代 onwards
pnpm scrape:kantei

# Dry run
pnpm scrape:kantei --dry-run

# Scrape from a specific cabinet number
pnpm scrape:kantei --min-cabinet=50
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
- Session tracking for carry-over bills

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
- Pass/fail/withdrawn/expired result
- Committee assignments (both chambers)
- Voting methods and dates
- Individual vote results (for push-button voting)
- Session tracking (submission session vs carry-over sessions)

### Database Tables Updated

- `bill` - Main bill records
- `bill_session` - Tracks which sessions a bill appeared in (submission and carry-over)
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
| `[endSession]` | Positional (2nd) | No | Dynamic | Last Diet session number to process (queries DB for latest `congress_session`, fallback 221) |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Scrape all sessions (198 to latest in DB)
pnpm scrape:sangiin

# Scrape a specific session range
pnpm scrape:sangiin 213 215

# Scrape only session 215
pnpm scrape:sangiin 215 215

# Dry run for a specific session
pnpm scrape:sangiin --dry-run 215 215
```

### Notes

- **Run this script first** before `scrape_shugiin.ts` as it creates the base bill records
- The `pnpm scrape:sangiin` command automatically chains `fix_scrape_sangiin.ts` after completion
- Use `pnpm scrape:sangiin-raw` to run without the fix script
- Processes bill details with concurrency of 5 parallel fetches
- Handles special deliberation status cases:
  - 撤回 (withdrawn) in remarks
  - 否決 (rejected) at plenary sessions
  - 未了 (incomplete/expired) when both plenary sessions are empty

---

## fix_scrape_sangiin.ts

### Purpose

Fixes known duplicate member records created by `scrape_sangiin.ts` where sangiin.go.jp vote pages use different name forms than what `scrape_kokkai_members.ts` established.

### What It Fixes

- Duplicate members caused by name variation (e.g. `河井あんり` → `河井案里`)
- Migrates `bill_votes_result_member` records from the duplicate to the canonical member
- Cleans up `member_party` and `member_group` records
- Merges name arrays and deletes the duplicate `member` record

### Database Tables Affected

- `member` - Merges and deletes duplicates
- `member_party` - Cleans up stale records
- `member_group` - Cleans up stale records
- `bill_votes_result_member` - Reassigns vote records

### Command-Line Parameters

None. Run via:

```bash
pnpm fix:sangiin
```

### Notes

- Automatically chained after `pnpm scrape:sangiin`
- Idempotent — safe to run multiple times

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
| `[startSession]` | Positional (1st) | No | 198 | First Diet session number to process |
| `[endSession]` | Positional (2nd) | No | Dynamic | Last Diet session number to process (queries DB for latest `congress_session`, fallback 221) |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (unless `--dry-run`) | PostgreSQL connection string |

### Usage Examples

```bash
# Scrape all sessions (198 to latest in DB)
pnpm scrape:shugiin

# Scrape a specific session range
pnpm scrape:shugiin 215 218

# Dry run
pnpm scrape:shugiin --dry-run 215 215
```

### Notes

- **Requires**: Bills must exist in database first (run `scrape_sangiin.ts` first)
- The `pnpm scrape:shugiin` command automatically chains `fix_scrape_shugiin.ts` after completion
- Use `pnpm scrape:shugiin-raw` to run without the fix script
- Uses the Kokkai API for committee chair name resolution
- Rate limits requests at 500ms intervals, processes bill details with concurrency of 5

---

## fix_scrape_shugiin.ts

### Purpose

Fixes two types of member record issues created by `scrape_shugiin.ts`:

1. **Duplicates**: Same person with different name variations (e.g. `髙木啓` vs `高木啓`)
2. **Squished members**: Two people accidentally merged into one record (e.g. `奥下剛光金村龍那` → `奥下剛光` + `金村龍那`)

### What It Fixes

- Migrates `bill_sponsors`, `bill_supporters`, and `bill_votes_result_member` records from duplicates to canonical members
- Splits squished member records into the correct individual members
- Deletes the incorrect `member` records after migration

### Database Tables Affected

- `member` - Merges/splits and deletes incorrect records
- `bill_sponsors` - Reassigns records
- `bill_supporters` - Reassigns records
- `bill_votes_result_member` - Reassigns records

### Command-Line Parameters

None. Run via:

```bash
pnpm fix:shugiin
```

### Notes

- Automatically chained after `pnpm scrape:shugiin`
- Idempotent — safe to run multiple times

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
- Uses exact name matching and `speakerYomi` validation to avoid false matches
- Computes date ranges for each group affiliation with contiguous period tracking (handles A→B→A correctly)
- Chamber determined from `member_party` table

### Database Tables Updated

- `group` - Political group/party records (with chamber)
- `member_group` - Member-group affiliation records with date ranges

### Command-Line Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `--dry-run` | Flag | No | - | Runs without writing to the database |
| `--resume` | Flag | No | - | Resume from checkpoint file (`.cache/member_groups_checkpoint.json`), skipping already-processed members |
| `--verbose` | Flag | No | - | Enable detailed logging of API calls and speech matching |
| `--clean` | Flag | No | - | Delete existing `member_group` records before processing |
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
pnpm scrape:member-groups

# Process members with speeches from 2020 onwards
pnpm scrape:member-groups 2020-01-01

# Process a specific date range
pnpm scrape:member-groups 2015-01-01 2020-12-31

# Process only a specific member
pnpm scrape:member-groups 1947-01-01 2025-01-01 42

# Resume from last checkpoint
pnpm scrape:member-groups --resume

# Clean existing records and reprocess
pnpm scrape:member-groups --clean

# Dry run with verbose output
pnpm scrape:member-groups --dry-run --verbose
```

### Technical Notes

- Implements **3 second delay** between API requests (as recommended by Kokkai API documentation)
- Fetches up to 100 speeches per API request
- Paginates through all speech records for each member
- Supports checkpointing via `ProgressTracker` for resumable long-running jobs

### Dependencies

- **Requires**: Members must exist in database first (populated by `scrape_kokkai_members.ts`)

---

## check_data_integrity.ts

### Purpose

Runs sanity checks against the scraped database and reports violations. Should be run after all scraping is complete to verify data consistency.

### Checks Performed

1. **閣法** → exactly 1 sponsor, 0 supporters, 0 sponsor groups
2. **参法** → ≥1 sponsor, 0 supporters, 0 sponsor groups
3. **衆法 with committeeName** → exactly 1 sponsor, 0 supporters, 0 sponsor groups
4. **衆法 without committeeName** → ≥1 each of sponsors, supporters, and sponsor groups
5. **`result=NULL`** only allowed for bills in the latest congress session
6. **`bill_votes_result_member`** only for 押しボタン votes in 参議院
7. **`bill_votes_result_group`** only for 衆議院 votes

### Command-Line Parameters

None. Run via:

```bash
pnpm check:data
```

### Exit Code

- `0` — all checks pass
- `1` — one or more checks failed (violations printed to stdout)

---

## Recommended Execution Order

For a complete data refresh, run the scripts in this order:

1. **`scrape_sessions.ts`** - Populates session dates (needed for dynamic end-session resolution)
2. **`scrape_kokkai_members.ts`** - Populates member and party records (including 衆議院 51期 and 参議院 27期 via sub-scrapers)
3. **`scrape_kantei.ts`** - Populates Prime Minister records
4. **`scrape_sangiin.ts`** + **`fix_scrape_sangiin.ts`** - Creates bill records and basic metadata, then fixes duplicates
5. **`scrape_shugiin.ts`** + **`fix_scrape_shugiin.ts`** - Adds sponsors and voting group data, then fixes duplicates
6. **`scrape_member_groups.ts`** - Populates group affiliation history
7. **`check_data_integrity.ts`** - Validates all scraped data

```bash
# Full refresh example
pnpm scrape:sessions
pnpm scrape:members
pnpm scrape:kantei
pnpm scrape:sangiin        # automatically runs fix:sangiin
pnpm scrape:shugiin        # automatically runs fix:shugiin
pnpm scrape:member-groups
pnpm check:data
```

## Common Environment Setup

All scripts require a PostgreSQL database connection. Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/candidate_match
```

## Page Caching

All scraping scripts use a shared `createPageCache()` mechanism that caches fetched HTML pages locally. This avoids re-fetching pages during retries or re-runs, reducing load on source websites.

## Rate Limiting & Concurrency

All scripts implement rate limiting to be respectful to the data sources:

| Script | Delay | Concurrency | Notes |
|--------|-------|-------------|-------|
| scrape_sessions.ts | None | 1 | Single page, low volume |
| scrape_kokkai_members.ts | 500ms | 5 (profile fetches) | Between term pages |
| scrape_sangiin_27.ts | 500ms | 1 | Called by scrape_kokkai_members |
| scrape_shugiin_51.ts | 500ms | 1 | Called by scrape_kokkai_members |
| scrape_kantei.ts | None | 5 (detail pages) | Low volume |
| scrape_sangiin.ts | None | 5 (bill details) | Uses page cache with retry |
| scrape_shugiin.ts | 500ms | 5 (bill details) | Between requests |
| scrape_member_groups.ts | 3000ms | 1 | Per Kokkai API documentation |

## npm Scripts Reference

| Script | Command |
|--------|---------|
| `scrape:sessions` | `tsx ./scripts/scrape_sessions.ts` |
| `scrape:members` | `tsx ./scripts/scrape_kokkai_members.ts` |
| `scrape:kantei` | `tsx ./scripts/scrape_kantei.ts` |
| `scrape:sangiin` | `tsx ./scripts/scrape_sangiin.ts && tsx ./scripts/fix_scrape_sangiin.ts` |
| `scrape:sangiin-raw` | `tsx ./scripts/scrape_sangiin.ts` |
| `fix:sangiin` | `tsx ./scripts/fix_scrape_sangiin.ts` |
| `scrape:shugiin` | `tsx ./scripts/scrape_shugiin.ts && tsx ./scripts/fix_scrape_shugiin.ts` |
| `scrape:shugiin-raw` | `tsx ./scripts/scrape_shugiin.ts` |
| `fix:shugiin` | `tsx ./scripts/fix_scrape_shugiin.ts` |
| `scrape:member-groups` | `tsx ./scripts/scrape_member_groups.ts` |
| `check:data` | `tsx ./scripts/check_data_integrity.ts` |
