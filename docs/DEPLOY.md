# Deploy checklist

## Option A — GitHub → Vercel (recommended)

1. Create a GitHub repo and push this project (`master` or `main`).
2. Vercel Dashboard → **Add New… → Project** → import the repo.
3. Framework preset: **Next.js**. Team: **Linus Uy's projects**.
4. (Optional) Add env vars from `.env.example` after creating a Supabase project.
5. Deploy. Later: drop CSVs in `data/csv/`, commit, push — or use `npm run sync` with Supabase.

## Option B — Vercel CLI

```bash
npx vercel login
npx vercel link --yes --project photomolecular-effect --scope linus-uy-s-projects
npx vercel --prod
```

## Supabase (for durable online uploads)

1. Create a Supabase project.
2. Run `supabase/migrations/001_init.sql` in the SQL editor.
3. Set in Vercel + `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

4. `npm run sync` from your machine after dropping CSVs into `data/csv/`.

## Local preview (already works)

```bash
npm install
npm run dev
```

Open http://localhost:3000 — sample `ch1`/`ch2` plots load immediately.
