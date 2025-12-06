# Svelte library

Everything you need to build a Svelte library, powered by [`sv`](https://npmjs.com/package/sv).

Read more about creating a library [in the docs](https://svelte.dev/docs/kit/packaging).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

Everything inside `src/lib` is part of your library, everything inside `src/routes` can be used as a showcase or preview app.

## Building

To build your library:

```sh
npm pack
```

To create a production version of your showcase app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Publishing

Go into the `package.json` and give your package the desired name through the `"name"` option. Also consider adding a `"license"` field and point it to a `LICENSE` file which you can create from a template (one popular option is the [MIT license](https://opensource.org/license/mit/)).

To publish your library to [npm](https://www.npmjs.com):

```sh
npm publish
```

## Data Scraping

This project includes several web scrapers to collect legislative data from Japanese government websites.

### Scraper Scripts

#### 1. `scrape_sangiin.ts` - House of Councillors (参議院)

Scrapes bill information from the House of Councillors website.

**Usage:**
```sh
npm run scrape:sangiin [startSession] [endSession] [--dry-run]
```

**Example:**
```sh
# Scrape sessions 213-219
npm run scrape:sangiin 213 219

# Dry run (no database writes)
npm run scrape:sangiin 213 219 -- --dry-run
```

**Data collected:**
- Bill metadata (type, session, number, submission date)
- Bill details (title, description)
- Committees involved
- Sponsors (for 閣法 bills, links to Prime Minister)
- Voting records (method, date, individual votes for 押しボタン)
- Deliberation status and passage

**Note:** This scraper should be run FIRST before running `scrape_shugiin.ts`.

#### 2. `scrape_shugiin.ts` - House of Representatives (衆議院)

Scrapes additional sponsor and voting group information from the House of Representatives website.

**Usage:**
```sh
npm run scrape:shugiin [startSession] [endSession] [--dry-run]
```

**Example:**
```sh
# Scrape sessions 213-219
npm run scrape:shugiin 213 219

# Dry run (no database writes)
npm run scrape:shugiin 213 219 -- --dry-run
```

**Data collected:**
- **For 衆法 (House of Representatives bills):**
  - Bill sponsors (議案提出者)
  - Sponsor groups (議案提出会派)
  - Bill supporters (議案提出の賛成者)

- **For 参法 (House of Councillors bills):**
  - Bill sponsors (議案提出者)
  - Committee chair information (when applicable)

- **For ALL bill types (閣法, 衆法, 参法):**
  - Voting groups for/against (衆議院審議時賛成会派・反対会派)

**Important:** Bills must exist in the database before running this scraper. Run `scrape_sangiin.ts` first.

#### 3. `scrape_kantei.ts` - Prime Minister's Office (首相官邸)

Scrapes information about Japanese Prime Ministers and their cabinets.

**Usage:**
```sh
npm run scrape:kantei [--dry-run]
```

### Scraping Workflow

To populate the database with complete bill information, run the scrapers in this order:

1. **First**, scrape the House of Councillors to create bill records:
   ```sh
   npm run scrape:sangiin 213 219
   ```

2. **Then**, scrape the House of Representatives to add sponsor and voting group details:
   ```sh
   npm run scrape:shugiin 213 219
   ```

3. **(Optional)** Scrape Prime Minister data if needed for cabinet bills:
   ```sh
   npm run scrape:kantei
   ```

### Notes

- All scrapers support `--dry-run` mode for testing without database writes
- The House of Representatives website uses Shift-JIS encoding, which is automatically handled
- Committee chair lookups for 参法 bills require additional implementation to parse proceedings (会議録)
- Sessions 198-219 are currently supported (as of December 2025)
