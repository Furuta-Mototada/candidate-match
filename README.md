# Candidate Match 🗳️# Candidate Match 🗳️# Svelte library



A data-driven political analysis platform for the Japanese National Diet. This application helps users discover which parliament members align most closely with their political views by analyzing voting patterns, bill submissions, and legislative behavior.



## FeaturesA data-driven political analysis platform for the Japanese National Diet. This application helps users discover which parliament members align most closely with their political views by analyzing voting patterns, bill submissions, and legislative behavior.Everything you need to build a Svelte library, powered by [`sv`](https://npmjs.com/package/sv).



- **Member Matching**: AI-powered adaptive matching to find parliament members whose voting patterns align with your views

- **Legislation Scores**: View detailed scoring breakdowns for each bill showing member support and opposition

- **Bill Clustering**: Machine learning-powered grouping of similar legislation for policy analysis## FeaturesRead more about creating a library [in the docs](https://svelte.dev/docs/kit/packaging).

- **Member Vectors**: Latent space visualization of members' political positions



## Tech Stack

- **Member Matching**: AI-powered adaptive matching to find parliament members whose voting patterns align with your views## Creating a project

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with Svelte 5

- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4- **Legislation Scores**: View detailed scoring breakdowns for each bill showing member support and opposition

- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)

- **ML/AI**: Python scripts using OpenAI API, sentence-transformers, scikit-learn- **Bill Clustering**: Machine learning-powered grouping of similar legislation for policy analysisIf you're seeing this, you've probably already done this step. Congrats!

- **Testing**: Vitest (unit) + Playwright (e2e)

- **i18n**: Paraglide.js (Japanese/English)- **Member Vectors**: Latent space visualization of members' political positions



## Prerequisites```sh



- **Node.js** 20+## Tech Stack# create a new project in the current directory

- **pnpm** (recommended) or npm

- **Python** 3.10+npx sv create

- **PostgreSQL** 14+ (or use a managed database like Neon, Supabase, etc.)

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with Svelte 5

## Getting Started

- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4# create a new project in my-app

### 1. Clone the Repository

- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)npx sv create my-app

```bash

git clone https://github.com/Furuta-Mototada/candidate-match.git- **ML/AI**: Python scripts using OpenAI API, sentence-transformers, scikit-learn```

cd candidate-match

```- **Testing**: Vitest (unit) + Playwright (e2e)



### 2. Install Dependencies- **i18n**: Paraglide.js (Japanese/English)## Developing



```bash

# Install Node.js dependencies

pnpm install## PrerequisitesOnce you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:



# Create Python virtual environment and install dependencies

python3 -m venv venv

source venv/bin/activate  # On Windows: venv\Scripts\activate- **Node.js** 20+ ```sh

pip install -r requirements.txt

```- **pnpm** (recommended) or npmnpm run dev



### 3. Environment Setup- **Python** 3.10+



Create a `.env` file in the project root:- **PostgreSQL** 14+ (or use a managed database like Neon, Supabase, etc.)# or start the server and open the app in a new browser tab



```bashnpm run dev -- --open

# Database connection string (required)

DATABASE_URL="postgresql://user:password@localhost:5432/candidate_match"## Getting Started```



# OpenAI API key (required for bill enrichment and debate summarization)

OPENAI_API_KEY="sk-..."

```### 1. Clone the RepositoryEverything inside `src/lib` is part of your library, everything inside `src/routes` can be used as a showcase or preview app.



### 4. Database Setup



```bash```bash## Building

# Generate database schema

pnpm db:generategit clone https://github.com/Furuta-Mototada/candidate-match.git



# Run migrationscd candidate-matchTo build your library:

pnpm db:migrate

```

# (Optional) Open Drizzle Studio to view database

pnpm db:studio```sh

```

### 2. Install Dependenciesnpm pack

### 5. Run the Development Server

```

```bash

pnpm dev```bash

```

# Install Node.js dependenciesTo create a production version of your showcase app:

The app will be available at `http://localhost:5173`

pnpm install

## Data Pipeline

```sh

This project scrapes and processes data from official Japanese government websites. Run these scripts in order to populate the database:

# Create Python virtual environment and install dependenciesnpm run build

### Step 1: Scrape Diet Sessions

python3 -m venv venv```

```bash

pnpm scrape:sessionssource venv/bin/activate  # On Windows: venv\Scripts\activate

```

pip install -r requirements.txtYou can preview the production build with `npm run preview`.

### Step 2: Scrape Members

```

```bash

pnpm scrape:members> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

pnpm scrape:member-groups

```### 3. Environment Setup



### Step 3: Scrape Bills## Publishing



```bashCreate a `.env` file in the project root:

# Scrape House of Councillors bills (run first)

pnpm scrape:sangiin 213 219Go into the `package.json` and give your package the desired name through the `"name"` option. Also consider adding a `"license"` field and point it to a `LICENSE` file which you can create from a template (one popular option is the [MIT license](https://opensource.org/license/mit/)).



# Scrape House of Representatives additional data (requires sangiin data)```bash

pnpm scrape:shugiin 213 219

# Database connection string (required)To publish your library to [npm](https://www.npmjs.com):

# Scrape Prime Minister data (for cabinet bills)

pnpm scrape:kanteiDATABASE_URL="postgresql://user:password@localhost:5432/candidate_match"

```

```sh

### Step 4: Calculate Legislation Scores

# OpenAI API key (required for bill enrichment and debate summarization)npm publish

```bash

pnpm calculate:legislationOPENAI_API_KEY="sk-..."```

```

```

### Step 5: Generate Bill Embeddings & Clustering

## Data Scraping

```bash

# Activate Python environment### 4. Database Setup

source venv/bin/activate

This project includes several web scrapers to collect legislative data from Japanese government websites.

# Generate embeddings (downloads ~1GB model on first run)

pnpm embeddings:generate```bash



# Run K-Means clustering# Generate database schema### Scraper Scripts

pnpm cluster:bills kmeans "Policy Topics" 10

pnpm db:generate

# Generate cluster names with LLM

pnpm cluster:name#### 1. `scrape_sangiin.ts` - House of Councillors (参議院)

```

# Run migrations

### Step 6: (Optional) Enrich Bills with AI

pnpm db:migrateScrapes bill information from the House of Councillors website.

```bash

# Scrape debate records

pnpm scrape:debates --limit 100

# (Optional) Open Drizzle Studio to view database**Usage:**

# Summarize debates with LLM

pnpm summarize:debates --limit 50pnpm db:studio```sh



# Generate bill summaries```npm run scrape:sangiin [startSession] [endSession] [--dry-run]

pnpm enrich:bills --limit 50

``````



### Step 7: Calculate Member Vectors### 5. Run the Development Server



This is done through the web UI at `/member-vectors` → "Save to Database"**Example:**



## NPM Scripts Reference```bash```sh



| Script | Description |pnpm dev# Scrape sessions 213-219

|--------|-------------|

| `pnpm dev` | Start development server |```npm run scrape:sangiin 213 219

| `pnpm build` | Build for production |

| `pnpm preview` | Preview production build |

| `pnpm test` | Run all tests |

| `pnpm test:unit` | Run Vitest unit tests |The app will be available at `http://localhost:5173`# Dry run (no database writes)

| `pnpm test:e2e` | Run Playwright e2e tests |

| `pnpm lint` | Check code formatting and lint |npm run scrape:sangiin 213 219 -- --dry-run

| `pnpm format` | Auto-format code |

| `pnpm db:push` | Push schema changes to database |## Data Pipeline```

| `pnpm db:generate` | Generate migration files |

| `pnpm db:migrate` | Run pending migrations |

| `pnpm db:studio` | Open Drizzle Studio |

| `pnpm db:reset` | Reset database and run migrations |This project scrapes and processes data from official Japanese government websites. Run these scripts in order to populate the database:**Data collected:**



## Project Structure- Bill metadata (type, session, number, submission date)



```### Step 1: Scrape Diet Sessions- Bill details (title, description)

candidate-match/

├── src/- Committees involved

│   ├── lib/

│   │   ├── components/      # Svelte components```bash- Sponsors (for 閣法 bills, links to Prime Minister)

│   │   ├── server/          # Server-side code (db, auth)

│   │   └── types/           # TypeScript type definitionspnpm scrape:sessions- Voting records (method, date, individual votes for 押しボタン)

│   └── routes/

│       ├── api/             # API endpoints```- Deliberation status and passage

│       ├── match/           # Member matching feature

│       ├── legislation-scores/

│       ├── bill-clustering/

│       └── member-vectors/### Step 2: Scrape Members**Note:** This scraper should be run FIRST before running `scrape_shugiin.ts`.

├── scripts/                 # Data scraping & processing scripts

├── docs/                    # Technical documentation

├── drizzle/                 # Database migrations

├── messages/                # i18n translation files```bash#### 2. `scrape_shugiin.ts` - House of Representatives (衆議院)

└── e2e/                     # End-to-end tests

```pnpm scrape:members



## Documentationpnpm scrape:member-groupsScrapes additional sponsor and voting group information from the House of Representatives website.



Detailed technical documentation is available in the `/docs` directory:```



- [User Guide](docs/USER_GUIDE.md) - How to use the application**Usage:**

- [Adaptive Matching](docs/ADAPTIVE_MATCHING.md) - How the AI matching algorithm works

- [Bill Clustering](docs/BILL_CLUSTERING.md) - Machine learning bill grouping### Step 3: Scrape Bills```sh

- [Bill Enrichment](docs/BILL_ENRICHMENT.md) - LLM-powered summaries and analysis

- [Legislation Scores](docs/LEGISLATION_SCORES.md) - Scoring methodologynpm run scrape:shugiin [startSession] [endSession] [--dry-run]

- [Member Vectors](docs/MEMBER_VECTORS.md) - Latent space analysis

- [Scraping Scripts](docs/SCRAPING_SCRIPTS.md) - Data collection details```bash```



## Contributing# Scrape House of Councillors bills (run first)



1. Fork the repositorypnpm scrape:sangiin 213 219**Example:**

2. Create a feature branch: `git checkout -b feature/my-feature`

3. Make your changes```sh

4. Run tests: `pnpm test`

5. Commit: `git commit -m 'Add my feature'`# Scrape House of Representatives additional data (requires sangiin data)# Scrape sessions 213-219

6. Push: `git push origin feature/my-feature`

7. Open a Pull Requestpnpm scrape:shugiin 213 219npm run scrape:shugiin 213 219



## License



This project is for educational and research purposes. Legislative data is sourced from publicly available Japanese government websites.# Scrape Prime Minister data (for cabinet bills)# Dry run (no database writes)



---pnpm scrape:kanteinpm run scrape:shugiin 213 219 -- --dry-run



Built with ❤️ for civic engagement and political transparency.``````




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
