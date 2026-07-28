import type { SensorPoint, TrialBookmark, TrialMeta } from "@/types/trial";
import {
  clockTimesEqual,
  normalizeClockTime,
  parseTrialFilename,
  type ParsedTrialFilename,
} from "@/lib/x-run-mirror";

function formatClockUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** End clock time for a sibling A/B/C trial (explicit end bookmark, else last CSV sample). */
export function endTimeForSiblingTrial(
  runLetter: string,
  meta: TrialMeta,
  points: SensorPoint[],
): string | null {
  for (const b of meta.bookmarks ?? []) {
    const note = (b.note || "").trim();
    if (!/end/i.test(note) || /start/i.test(note)) continue;
    const m = note.match(/Trial\s+([ABC])\b/i);
    if (m && m[1].toUpperCase() === runLetter) {
      return normalizeClockTime(b.time);
    }
  }

  if (points.length > 0) {
    return formatClockUtc(new Date(points[points.length - 1].time));
  }
  return null;
}

/**
 * Plot-only "Trial A/B/C end" markers for an X-run trial.
 * Computed at series load (replot), never written to the database.
 */
export async function computeXRunDynamicEndBookmarks(
  xMeta: TrialMeta,
  allTrials: TrialMeta[],
  loadSeries: (id: string) => Promise<{ meta: TrialMeta; points: SensorPoint[] } | null>,
  seriesCache: Map<string, { meta: TrialMeta; points: SensorPoint[] } | null>,
): Promise<TrialBookmark[]> {
  const xParsed = parseTrialFilename(xMeta.filename);
  if (!xParsed || xParsed.run !== "X") return [];

  const siblings = allTrials
    .filter((t) => {
      const p = parseTrialFilename(t.filename);
      return (
        p &&
        p.channel === xParsed.channel &&
        p.date === xParsed.date &&
        p.run &&
        p.run !== "X"
      );
    })
    .sort((a, b) =>
      (parseTrialFilename(a.filename)?.run ?? "").localeCompare(
        parseTrialFilename(b.filename)?.run ?? "",
      ),
    );

  const stored = xMeta.bookmarks ?? [];
  const out: TrialBookmark[] = [];

  for (const sib of siblings) {
    const sibParsed = parseTrialFilename(sib.filename)! as ParsedTrialFilename;
    const runLetter = sibParsed.run;

    let cached = seriesCache.get(sib.id);
    if (cached === undefined) {
      cached = await loadSeries(sib.id);
      seriesCache.set(sib.id, cached);
    }
    if (!cached) continue;

    const time = endTimeForSiblingTrial(runLetter, cached.meta, cached.points);
    if (!time) continue;

    if (stored.some((b) => clockTimesEqual(b.time, time))) continue;

    out.push({
      id: `computed:end:${xParsed.channel}:${xParsed.date}:${runLetter}`,
      time,
      note: `Trial ${runLetter} end`,
    });
  }

  return out;
}

/** Stored + plot-computed bookmarks for rendering (deduped by clock time). */
export function plotBookmarksForSeries(series: {
  meta: TrialMeta;
  computedBookmarks?: TrialBookmark[];
}): TrialBookmark[] {
  const stored = series.meta.bookmarks ?? [];
  const computed = series.computedBookmarks ?? [];
  const merged = [...stored];
  for (const c of computed) {
    if (merged.some((b) => clockTimesEqual(b.time, c.time))) continue;
    merged.push(c);
  }
  return merged;
}

export function isComputedBookmarkId(id: string): boolean {
  return id.startsWith("computed:");
}
