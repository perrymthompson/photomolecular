# Setup

## 1. Install & run locally

```bash
npm install
cp .env.example .env.local   # optional until you add Supabase
npm run dev
```

## 2. Supabase (recommended for online CSV sync)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/001_init.sql`.
3. In **Storage**, confirm bucket `chamber-csvs` exists (the migration inserts it).
4. Project **Settings → API**: copy URL, anon key, and **service role** key.
5. Put them in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
PLOT_DATA_SOURCE=remote
```

6. Sync local CSVs:

```bash
npm run sync
```

> The service role key must stay server-side only (never expose it in client code). Vercel env vars marked as Server/Secret are fine.
>
> `PLOT_DATA_SOURCE=remote` is useful for localhost testing before a git push: it forces the app to load from online Supabase and prevents silent fallback to `data/csv/`.

## 3. GitHub + Vercel

1. Create a GitHub repo and push this project.
2. In Vercel: **Add New Project** → import the repo → framework **Next.js**.
3. Add the same env vars in Vercel **Settings → Environment Variables**.
4. Deploy. Each push to `main` redeploys the site.

If you store CSVs only in Git (`data/csv/`), the deployment can read them at runtime on the serverless filesystem **bundled with the build**. Prefer Supabase Storage for large / frequently updated files so you are not committing multi‑MB CSVs forever.

## 4. Desktop folder habit

Point a shortcut (or just work in-repo) at:

```text
photomolecular-effect/data/csv/
```

Drop new exports there, then either `git add` + push, or `npm run sync`.

## Security note

Open RLS policies in `001_init.sql` are intentional for a private lab tool. Before making the site public, lock policies down (auth) or protect the Vercel deployment with password / SSO.
