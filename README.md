# Candidate Match 🗳️# Svelte library



A data-driven political analysis platform for the Japanese National Diet. This application helps users discover which parliament members align most closely with their political views by analyzing voting patterns, bill submissions, and legislative behavior.Everything you need to build a Svelte library, powered by [`sv`](https://npmjs.com/package/sv).



## FeaturesRead more about creating a library [in the docs](https://svelte.dev/docs/kit/packaging).



- **Member Matching**: AI-powered adaptive matching to find parliament members whose voting patterns align with your views## Creating a project

- **Legislation Scores**: View detailed scoring breakdowns for each bill showing member support and opposition

- **Bill Clustering**: Machine learning-powered grouping of similar legislation for policy analysisIf you're seeing this, you've probably already done this step. Congrats!

- **Member Vectors**: Latent space visualization of members' political positions

```sh

## Tech Stack# create a new project in the current directory

npx sv create

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with Svelte 5

- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4# create a new project in my-app

- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)npx sv create my-app

- **ML/AI**: Python scripts using OpenAI API, sentence-transformers, scikit-learn```

- **Testing**: Vitest (unit) + Playwright (e2e)

- **i18n**: Paraglide.js (Japanese/English)## Developing



## PrerequisitesOnce you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:



- **Node.js** 20+ ```sh

- **pnpm** (recommended) or npmnpm run dev

- **Python** 3.10+

- **PostgreSQL** 14+ (or use a managed database like Neon, Supabase, etc.)# or start the server and open the app in a new browser tab

npm run dev -- --open

## Getting Started```



### 1. Clone the RepositoryEverything inside `src/lib` is part of your library, everything inside `src/routes` can be used as a showcase or preview app.



```bash## Building

git clone https://github.com/Furuta-Mototada/candidate-match.git

cd candidate-matchTo build your library:

```

```sh

### 2. Install Dependenciesnpm pack

```

```bash

# Install Node.js dependenciesTo create a production version of your showcase app:

pnpm install

```sh

# Create Python virtual environment and install dependenciesnpm run build

python3 -m venv venv```

source venv/bin/activate  # On Windows: venv\Scripts\activate

pip install -r requirements.txtYou can preview the production build with `npm run preview`.

```

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

### 3. Environment Setup

## Publishing

Create a `.env` file in the project root:

Go into the `package.json` and give your package the desired name through the `"name"` option. Also consider adding a `"license"` field and point it to a `LICENSE` file which you can create from a template (one popular option is the [MIT license](https://opensource.org/license/mit/)).

```bash

# Database connection string (required)To publish your library to [npm](https://www.npmjs.com):

DATABASE_URL="postgresql://user:password@localhost:5432/candidate_match"

```sh

# OpenAI API key (required for bill enrichment and debate summarization)npm publish

OPENAI_API_KEY="sk-..."```

```

## Data Scraping

### 4. Database Setup

This project includes several web scrapers to collect legislative data from Japanese government websites.

```bash

# Generate database schema### Scraper Scripts

pnpm db:generate

#### 1. `scrape_sangiin.ts` - House of Councillors (参議院)

# Run migrations

pnpm db:migrateScrapes bill information from the House of Councillors website.



# (Optional) Open Drizzle Studio to view database**Usage:**

pnpm db:studio```sh

```npm run scrape:sangiin [startSession] [endSession] [--dry-run]

```

### 5. Run the Development Server

**Example:**

```bash```sh

pnpm dev# Scrape sessions 213-219

```npm run scrape:sangiin 213 219



The app will be available at `http://localhost:5173`# Dry run (no database writes)

npm run scrape:sangiin 213 219 -- --dry-run

## Data Pipeline```



This project scrapes and processes data from official Japanese government websites. Run these scripts in order to populate the database:**Data collected:**

- Bill metadata (type, session, number, submission date)

### Step 1: Scrape Diet Sessions- Bill details (title, description)

- Committees involved

```bash- Sponsors (for 閣法 bills, links to Prime Minister)

pnpm scrape:sessions- Voting records (method, date, individual votes for 押しボタン)

```- Deliberation status and passage



### Step 2: Scrape Members**Note:** This scraper should be run FIRST before running `scrape_shugiin.ts`.



```bash#### 2. `scrape_shugiin.ts` - House of Representatives (衆議院)

pnpm scrape:members

pnpm scrape:member-groupsScrapes additional sponsor and voting group information from the House of Representatives website.

```

**Usage:**

### Step 3: Scrape Bills```sh

npm run scrape:shugiin [startSession] [endSession] [--dry-run]

```bash```

# Scrape House of Councillors bills (run first)

pnpm scrape:sangiin 213 219**Example:**

```sh

# Scrape House of Representatives additional data (requires sangiin data)# Scrape sessions 213-219

pnpm scrape:shugiin 213 219npm run scrape:shugiin 213 219



# Scrape Prime Minister data (for cabinet bills)# Dry run (no database writes)

pnpm scrape:kanteinpm run scrape:shugiin 213 219 -- --dry-run

``````



### Step 4: Calculate Legislation Scores**Data collected:**

- **For 衆法 (House of Representatives bills):**

```bash  - Bill sponsors (議案提出者)

pnpm calculate:legislation  - Sponsor groups (議案提出会派)

```  - Bill supporters (議案提出の賛成者)



### Step 5: Generate Bill Embeddings & Clustering- **For 参法 (House of Councillors bills):**

  - Bill sponsors (議案提出者)

```bash  - Committee chair information (when applicable)

# Activate Python environment

source venv/bin/activate- **For ALL bill types (閣法, 衆法, 参法):**

  - Voting groups for/against (衆議院審議時賛成会派・反対会派)

# Generate embeddings (downloads ~1GB model on first run)

pnpm embeddings:generate**Important:** Bills must exist in the database before running this scraper. Run `scrape_sangiin.ts` first.



# Run K-Means clustering#### 3. `scrape_kantei.ts` - Prime Minister's Office (首相官邸)

pnpm cluster:bills kmeans "Policy Topics" 10

Scrapes information about Japanese Prime Ministers and their cabinets.

# Generate cluster names with LLM

pnpm cluster:name**Usage:**

``````sh

npm run scrape:kantei [--dry-run]

### Step 6: (Optional) Enrich Bills with AI```



```bash### Scraping Workflow

# Scrape debate records

pnpm scrape:debates --limit 100To populate the database with complete bill information, run the scrapers in this order:



# Summarize debates with LLM1. **First**, scrape the House of Councillors to create bill records:

pnpm summarize:debates --limit 50   ```sh

   npm run scrape:sangiin 213 219

# Generate bill summaries   ```

pnpm enrich:bills --limit 50

```2. **Then**, scrape the House of Representatives to add sponsor and voting group details:

   ```sh

### Step 7: Calculate Member Vectors   npm run scrape:shugiin 213 219

   ```

This is done through the web UI at `/member-vectors` → "Save to Database"

3. **(Optional)** Scrape Prime Minister data if needed for cabinet bills:

## NPM Scripts Reference   ```sh

   npm run scrape:kantei

| Script | Description |   ```

|--------|-------------|

| `pnpm dev` | Start development server |### Notes

| `pnpm build` | Build for production |

| `pnpm preview` | Preview production build |- All scrapers support `--dry-run` mode for testing without database writes

| `pnpm test` | Run all tests |- The House of Representatives website uses Shift-JIS encoding, which is automatically handled

| `pnpm test:unit` | Run Vitest unit tests |- Committee chair lookups for 参法 bills require additional implementation to parse proceedings (会議録)

| `pnpm test:e2e` | Run Playwright e2e tests |- Sessions 198-219 are currently supported (as of December 2025)

| `pnpm lint` | Check code formatting and lint |
| `pnpm format` | Auto-format code |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:generate` | Generate migration files |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:reset` | Reset database and run migrations |

## Project Structure

```
candidate-match/
├── src/
│   ├── lib/
│   │   ├── components/      # Svelte components
│   │   ├── server/          # Server-side code (db, auth)
│   │   └── types/           # TypeScript type definitions
│   └── routes/
│       ├── api/             # API endpoints
│       ├── match/           # Member matching feature
│       ├── legislation-scores/
│       ├── bill-clustering/
│       └── member-vectors/
├── scripts/                 # Data scraping & processing scripts
├── docs/                    # Technical documentation
├── drizzle/                 # Database migrations
├── messages/                # i18n translation files
└── e2e/                     # End-to-end tests
```

## Documentation

Detailed technical documentation is available in the `/docs` directory:

- [Adaptive Matching](docs/ADAPTIVE_MATCHING.md) - How the AI matching algorithm works
- [Bill Clustering](docs/BILL_CLUSTERING.md) - Machine learning bill grouping
- [Bill Enrichment](docs/BILL_ENRICHMENT.md) - LLM-powered summaries and analysis
- [Legislation Scores](docs/LEGISLATION_SCORES.md) - Scoring methodology
- [Member Vectors](docs/MEMBER_VECTORS.md) - Latent space analysis
- [Scraping Scripts](docs/SCRAPING_SCRIPTS.md) - Data collection details

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `pnpm test`
5. Commit: `git commit -m 'Add my feature'`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

## License

This project is for educational and research purposes. Legislative data is sourced from publicly available Japanese government websites.

---

Built with ❤️ for civic engagement and political transparency.
