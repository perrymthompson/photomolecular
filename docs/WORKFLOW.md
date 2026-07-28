# Daily workflow

## Adding a new run

1. Export chamber CSVs from the sensor software.
2. Name them like `ch2_07252026B_lau.csv`  
   (`ch{N}_{MMDDYYYY}{optional run letter}_…`).
3. Save into `data/csv/`.
4. Sync:
   - **New files:** `npm run sync`
   - **Changed CSV, same filename:** `npm run sync:refresh` (keeps notes / bookmarks / session starts)
   - **Git-only:** `git add data/csv && git commit && git push`
5. Open the site → **Dashboard**.
6. For each trial, enter:
   - **Notes** (e.g. `Dark`, `this has light`)
   - **Session start** as `HH:MM:SS` (e.g. `12:38:00`) — used for dashed markers and aligned plots
7. Go to **Plots**, select the trials to compare.

## Comparing days

- Trials are grouped by the date parsed from the filename.
- Select any mix of chambers / days in the left panel.
- Use **Clock time** to overlay calendar timestamps.
- Use **Align session starts** when every selected trial has a session start — x-axis becomes elapsed minutes since that trial’s own start (Plot E from the R script).

## Aesthetic changes

Chart theme, LOWESS span, and colors live in code (`src/lib/colors.ts`, `src/lib/lowess.ts`, `src/components/charts/SensorPlot.tsx`). Change once, redeploy — no re-running R for each tweak. Metadata stays editable online without regenerating images.

## Mapping from the R script

| R script step | Web app |
|---------------|---------|
| `tk_choose.files` | Drop into `data/csv/` or Dashboard upload |
| Notes popup | Dashboard → Notes field |
| Session start popup | Dashboard → Session start |
| Plots A–D (clock time) | Plots → Combined / AH / RH / Temp + Clock time |
| Plot E (aligned) | Plots → Align session starts |
| `ggsave` PNG | Plotly camera icon → download PNG |
