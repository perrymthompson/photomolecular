# Photomolecular Effect — Chamber Sensor Plots

Interactive web dashboard for chamber sensor CSV data: absolute humidity, relative humidity, and temperature — with the dark aesthetic and metadata workflow from your R plotting script, hosted on Vercel.

## What you get

- **Drop CSVs locally** into `data/csv/` → sync online (or upload in the browser)
- **Interactive Plotly charts**: hover crosshair, zoom, pan, legend toggle, PNG export
- **Combined stacked view** (AH / RH / Temp) matching your R facets
- **Session-start alignment** so trials from different clock times share an elapsed-time axis
- **Online metadata dashboard**: notes + session start times (no more R popups for every aesthetic tweak)

## Quick start (local)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Sample trials (`ch1` / `ch2` for July 24, 2026 Run A) are already in `data/csv/` so plots work immediately.

To preview against the live Supabase-backed dataset on localhost before pushing, put your Supabase keys in `.env.local` and set:

```env
PLOT_DATA_SOURCE=remote
```

That disables the silent fallback to `data/csv/` and makes local dev fail loudly if Supabase is unavailable, so you know you are testing the online data path.

| Route | Purpose |
|-------|---------|
| `/` | Plot workspace — select trials, clock vs aligned time |
| `/dashboard` | Upload CSVs, edit notes & session start times |

## Everyday workflow

1. Save sensor exports into `data/csv/` (naming: `ch1_07242026A_lau.csv`).
2. Either:
   - **Local / Git**: commit & push (GitHub → Vercel auto-deploys), **or**
   - **Cloud sync**: configure Supabase, then `npm run sync` to upload CSVs.
3. Open the deployed site → **Dashboard** → set notes / session start → **Plots**.

See [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/SETUP.md](docs/SETUP.md), [docs/DEPLOY.md](docs/DEPLOY.md), and [docs/DESKTOP_FOLDER.md](docs/DESKTOP_FOLDER.md).

## CSV format

Same as the R script (no header used; first row skipped):

| Col | Field |
|-----|--------|
| V1 | sensor ID |
| V2 | chamber / sensor name |
| V3 | channel |
| V4 | measure type (`…RH…` ⇒ humidity, else temperature) |
| V5 | value |
| V6 | timestamp `YYYY-MM-DD HH:MM:SS` |

Absolute humidity uses Magnus–Tetens (identical formula to the R script). Trends use LOWESS with `span = 0.08`.

## Project layout

```text
data/csv/                 ← drop sensor CSVs here (desktop folder habit)
data/metadata.json        ← local-mode trial notes / session starts
src/app/                  ← Next.js pages (/ and /dashboard)
src/app/api/              ← trials + CSV upload APIs
src/components/charts/    ← Plotly workspace (R-like dark theme)
src/components/dashboard/ ← metadata forms + uploader
src/lib/                  ← parse CSV, AH, LOWESS, colors, storage
supabase/migrations/      ← Postgres + Storage schema
scripts/sync-csv.mjs      ← npm run sync → Supabase
docs/                     ← setup + daily workflow
```

## Stack

- **Next.js** (App Router) on **Vercel**
- **Plotly.js** for interactive charts
- **Supabase** (optional but recommended online): Storage for CSVs + Postgres for metadata
- **Local fallback**: `data/csv/` + `data/metadata.json` (no cloud required for development)

> On Vercel, filesystem uploads are ephemeral. For production online sync, set up Supabase (see docs/SETUP.md). Git-committed files under `data/csv/` are also available at deploy time.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm run sync` | Sync `data/csv/` → Supabase (or refresh local metadata) |
| `npm run lint` | ESLint |

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel → **Add New Project** → import the repo (team: Linus Uy's projects).
3. Add Supabase env vars if using cloud sync (see `.env.example`).
4. Deploy. Future pushes to `main` redeploy automatically.

Or from a logged-in CLI:

```bash
npx vercel login
npx vercel link --project photomolecular-effect --scope linus-uy-s-projects
npx vercel --prod
```

## Environment

Copy `.env.example` → `.env.local`. Without Supabase keys the app runs fully in local mode.
