# Drop chamber CSV files in this folder

Example names:

- `ch1_07242026A_lau.csv`
- `ch2_07242026A_lau.csv`

Then run `npm run sync` (Supabase) or commit & push for Git-based deploys.

Metadata (notes, session start) is edited on the web Dashboard and stored in
`data/metadata.json` (local mode) or the Supabase `trials` table (cloud mode).
