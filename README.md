# Candidate Match 🗳️

A data-driven political analysis platform for the Japanese National Diet. This application helps users discover which parliament members and parties align most closely with their political views by analyzing voting patterns, bill submissions, and legislative behavior.

## Features

- **Adaptive Member Matching**: AI-powered [Computerized Adaptive Testing (CAT)](docs/ADAPTIVE_MATCHING.md) to find parliament members whose voting patterns align with your views, with warm-start dimensional coverage and controversy-boosted question selection
- **Party Matching**: Dual-method party-level scoring using both current roster averages and [historical temporal-overlap weighting](docs/PARTY_MATCHING.md)
- **Vote Delegation**: [Liquid democracy](docs/DELEGATION_FEATURE.md)-inspired delegation chains where users can delegate bill votes to trusted friends, with cycle detection, anonymization, and rationale tracking
- **Friend System**: Social features including friend requests, user search, and delegation-based collaboration
- **Legislation Scores**: View detailed scoring breakdowns for each bill showing member support and opposition
- **Bill Clustering**: Machine learning-powered grouping of similar legislation using Sentence-BERT embeddings with K-Means or HDBSCAN
- **Member Vectors**: Latent space visualization of members' political positions via weighted SVD/PCA
- **Algorithm Evaluation**: [Benchmarking dashboard](docs/ALGORITHM_EVALUATION.md) comparing CAT vs random vs most-controversial question strategies
- **Notifications**: Real-time notification system for friend requests, delegation events, and vote changes
- **Bill Enrichment**: LLM-powered bill summaries and debate analysis using OpenAI API
- **i18n**: Full Japanese and English support

## Tech Stack

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) with Svelte 5
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Auth**: Session-token-based authentication with Argon2 password hashing
- **ML/AI**: Python scripts using OpenAI API, sentence-transformers, scikit-learn, HDBSCAN
- **Image Hosting**: ImageKit for avatar uploads
- **Testing**: Vitest (unit) + Playwright (e2e)
- **i18n**: Paraglide.js (Japanese/English)
- **Analytics**: Vercel Analytics & Speed Insights

## Prerequisites

- **Node.js** 20+
- **pnpm** (recommended) or npm
- **Python** 3.10+
- **PostgreSQL** 14+ (or use a managed database like Neon, Supabase, etc.)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Furuta-Mototada/candidate-match.git
cd candidate-match
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
pnpm install

# Create Python virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Environment Setup

Create a `.env` file in the project root:

```bash
# Database connection string (required)
DATABASE_URL="postgresql://user:password@localhost:5432/candidate_match"

# OpenAI API key (required for bill enrichment and debate summarization)
OPENAI_API_KEY="sk-..."

# ImageKit credentials (required for avatar uploads)
IMAGEKIT_PUBLIC_KEY="..."
IMAGEKIT_PRIVATE_KEY="..."
IMAGEKIT_URL_ENDPOINT="..."
```

### 4. Database Setup

```bash
# Generate database schema
pnpm db:generate

# Run migrations
pnpm db:migrate

# (Optional) Open Drizzle Studio to view database
pnpm db:studio
```

### 5. Run the Development Server

```bash
pnpm dev
```

The app will be available at `http://localhost:5173`

## Data Pipeline

This project scrapes and processes data from official Japanese government websites. Run these scripts in order to populate the database:

### Step 1: Scrape Diet Sessions

```bash
pnpm scrape:sessions
```

### Step 2: Scrape Members

```bash
pnpm scrape:members
pnpm scrape:member-groups
```

### Step 3: Scrape Bills

```bash
# Scrape House of Councillors bills (run first)
pnpm scrape:sangiin 213 219

# Scrape House of Representatives additional data (requires sangiin data)
pnpm scrape:shugiin 213 219

# Scrape Prime Minister data (for cabinet bills)
pnpm scrape:kantei
```

### Step 4: Calculate Legislation Scores

```bash
pnpm calculate:legislation
```

### Step 5: Generate Bill Embeddings and Clustering

```bash
# Activate Python environment
source venv/bin/activate

# Generate embeddings (downloads ~1GB model on first run)
pnpm embeddings:generate

# Run K-Means clustering
pnpm cluster:bills kmeans "Policy Topics" 10

# Generate cluster names with LLM
pnpm cluster:name
```

### Step 6: (Optional) Enrich Bills with AI

```bash
# Scrape debate records
pnpm scrape:debates --limit 100

# Summarize debates with LLM
pnpm summarize:debates --limit 50

# Generate bill summaries
pnpm enrich:bills --limit 50
```

### Step 7: Calculate Member Vectors

```bash
pnpm calculate:vectors
```

Or use the web UI at `/member-vectors` and click "Save to Database".

## NPM Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview production build |
| `pnpm test` | Run all tests |
| `pnpm test:unit` | Run Vitest unit tests |
| `pnpm test:e2e` | Run Playwright e2e tests |
| `pnpm lint` | Check code formatting and lint |
| `pnpm format` | Auto-format code |
| `pnpm check` | Run svelte-check type checking |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:generate` | Generate migration files |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:reset` | Reset database and run migrations |
| `pnpm check:data` | Check data integrity |
| `pnpm check:scores` | Sanity check legislation scores |

## Project Structure

```
candidate-match/
├── src/
│   ├── lib/
│   │   ├── components/       # Svelte components (shared + match/)
│   │   ├── server/           # Server-side code
│   │   │   ├── db/           # Database schema and connection
│   │   │   ├── auth.ts       # Session-based authentication
│   │   │   ├── matching.ts   # CAT adaptive matching algorithm
│   │   │   ├── party-matching.ts  # Party-level score aggregation
│   │   │   ├── delegation-helpers.ts  # Vote delegation chain logic
│   │   │   └── notifications.ts   # Notification system
│   │   ├── stores/           # Svelte stores
│   │   └── types/            # TypeScript type definitions
│   └── routes/
│       ├── api/              # API endpoints
│       │   ├── bills/        # Bill data
│       │   ├── delegations/  # Vote delegation API
│       │   ├── friends/      # Friend system API
│       │   ├── match/        # Matching API
│       │   ├── notifications/# Notifications API
│       │   ├── party-match/  # Party matching API
│       │   ├── evaluation/   # Algorithm benchmarking API
│       │   └── ...           # Other API routes
│       ├── auth/             # Login, register, logout
│       ├── match/            # Member matching feature
│       │   └── saved/        # Saved sessions, answers & delegations
│       ├── friends/          # Friend management
│       ├── settings/         # User profile settings
│       ├── evaluation/       # Algorithm evaluation dashboard
│       ├── legislation-scores/
│       ├── bill-clustering/
│       └── member-vectors/
├── scripts/                  # Data scraping and processing scripts
├── docs/                     # Technical documentation
├── drizzle/                  # Database migrations
├── messages/                 # i18n translation files (en, jp)
└── e2e/                      # End-to-end tests
```

## Documentation

Detailed technical documentation is available in the `/docs` directory:

- [User Guide](docs/USER_GUIDE.md) - How to use the application (日本語)
- [User Guide (Detailed)](docs/USER_GUIDE_DETAIL.md) - Comprehensive technical guide (日本語)
- [Adaptive Matching](docs/ADAPTIVE_MATCHING.md) - How the CAT matching algorithm works
- [Party Matching](docs/PARTY_MATCHING.md) - Party-level score aggregation methods
- [Delegation Feature](docs/DELEGATION_FEATURE.md) - Vote delegation and liquid democracy
- [Bill Clustering](docs/BILL_CLUSTERING.md) - Machine learning bill grouping
- [Bill Enrichment](docs/BILL_ENRICHMENT.md) - LLM-powered summaries and analysis
- [Legislation Scores](docs/LEGISLATION_SCORES.md) - Scoring methodology
- [Member Vectors](docs/MEMBER_VECTORS.md) - Latent space analysis
- [Algorithm Evaluation](docs/ALGORITHM_EVALUATION.md) - CAT benchmarking methodology
- [Scraping Scripts](docs/SCRAPING_SCRIPTS.md) - Data collection pipeline details
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
