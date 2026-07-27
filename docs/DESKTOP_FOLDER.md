# Link a Desktop folder to data/csv (Windows)

So you can save CSVs on your Desktop and have them appear in the project:

```powershell
# From PowerShell (run once)
$desktop = [Environment]::GetFolderPath("Desktop")
$link = Join-Path $desktop "chamber-csvs"
$target = "C:\Users\101095994\photomolecular-effect\data\csv"

# Option 1: directory junction (no admin needed usually)
cmd /c mklink /J "$link" "$target"

# Then save files into Desktop\chamber-csvs\
# and run:  npm run sync   (or git add / commit / push)
```

If you prefer a normal folder elsewhere, just copy or move CSVs into `data/csv/` before syncing.
