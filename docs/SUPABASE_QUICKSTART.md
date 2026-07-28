# Supabase setup (required for Vercel uploads & metadata)

On Vercel the app **cannot write to local files**. You need Supabase for:
- storing CSV files
- saving trial notes / session start times
- listing trials on the live site

## Step 1 — Create a Supabase project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. **New project** → pick a name (e.g. `photomolecular-lab`)
3. Set a database password (save it somewhere safe)
4. Wait until the project finishes provisioning (~1–2 min)

## Step 2 — Run the database migration

1. In Supabase, open **SQL Editor**
2. Click **New query**
3. Copy the entire contents of `supabase/migrations/001_init.sql` from this repo
4. Click **Run**

You should see success. This creates:
- `trials` table
- `chamber-csvs` storage bucket
- basic RLS policies

## Step 3 — Get your API keys

In Supabase: **Project Settings → API**

Copy these three values:

| Name | Where to use |
|------|----------------|
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` |
| **anon public** key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role** key (secret) | `SUPABASE_SERVICE_ROLE_KEY` |

⚠️ Never put `service_role` in client-side code or commit it to GitHub.

## Step 4 — Add env vars in Vercel

1. Open [Vercel dashboard](https://vercel.com/dashboard) → your **photomolecular** project
2. **Settings → Environment Variables**
3. Add all three variables for **Production** (and Preview if you want):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

4. **Save**
5. Go to **Deployments** → **Redeploy** the latest commit (env vars only apply after redeploy)

## Step 5 — Verify storage bucket

In Supabase: **Storage**

Confirm bucket **`chamber-csvs`** exists. If not, re-run the SQL migration.

## Step 5b — Fix upload RLS errors (if needed)

If Dashboard upload fails with **"new row violates row-level security policy"**:

1. Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel (not just the anon key)
2. Redeploy after adding it
3. Also run `supabase/migrations/002_storage_policies.sql` in the Supabase SQL Editor

## Step 6 — Test on your live site

1. Open `/dashboard` on your Vercel URL
2. Upload a CSV → should show green success message
3. Expand day → run → file, set **Session start** and **Notes**, click **Save**
4. Go to **Plots**, select trials, view charts

## Optional — local development with Supabase

Create `.env.local` in the project root (same three vars as above), then:

```bash
npm run dev
```

## Quick health check

After redeploying, visit:

```
https://YOUR-SITE.vercel.app/api/health
```

You want: `{"supabase":true,"serviceRole":true,"vercel":true}`

## Troubleshooting

### `Editing local trial metadata requires Supabase on Vercel`
→ Env vars are missing or deployment wasn’t redeployed after adding them.

### Upload fails with storage error
→ Bucket `chamber-csvs` missing — re-run `001_init.sql`.

### Upload fails with RLS / permission error
→ Run `supabase/migrations/002_storage_policies.sql` in the Supabase SQL Editor, and confirm `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel (then redeploy). Check `/api/health` shows `"serviceRole":true`.
