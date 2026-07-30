import { sessionStartIso } from "@/lib/parse-csv";
import type { SensorPoint, TrialBookmark, TrialMeta } from "@/types/trial";
import {
  clockTimesEqual,
  normalizeClockTime,
  parseTrialFilename,
} from "@/lib/x-run-mirror";

/** Prefer amb, then ch1, ch2, ch3 when picking one end time per run. */
const CHANNEL_PRIORITY = ["amb", "ch1", "ch2", "ch3"];

function formatClockUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function channelRank(channel: string): number {
  const i = CHANNEL_PRIORITY.indexOf(channel.toLowerCase());
  return i >= 0 ? i : 99;
}

/** Resolve an end clock onto the trial timeline (may roll to next day past midnight). */
function resolveEndInstant(
  firstSampleIso: string,
  clockTime: string,
): string {
  let iso = sessionStartIso(firstSampleIso, clockTime);
  if (!iso) return firstSampleIso;
  const firstMs = Date.parse(firstSampleIso);
  const targetMs = Date.parse(iso);
  // Overnight ends (e.g. 00:46 after an evening start) land before firstSample
  // on the same calendar date, so roll forward one day.
  if (targetMs < firstMs) {
    iso = new Date(targetMs + 86_400_000).toISOString();
  }
  return iso;
}

/**
 * Resolve a start clock onto the trial's calendar day.
 * Uses the MMDDYYYY date from the filename when available — never day-rolls.
 * (Unlike ends: a start a few minutes before the first CSV row is still same-day.)
 */
function resolveStartInstant(
  meta: TrialMeta,
  firstSampleIso: string,
  clockTime: string,
): string {
  const parsed = parseTrialFilename(meta.filename);
  const clock = normalizeClockTime(clockTime);
  if (parsed?.date && /^\d{8}$/.test(parsed.date) && clock) {
    const mm = parsed.date.slice(0, 2);
    const dd = parsed.date.slice(2, 4);
    const yyyy = parsed.date.slice(4, 8);
    const full =
      clock.length === 5
        ? `${yyyy}-${mm}-${dd}T${clock}:00Z`
        : `${yyyy}-${mm}-${dd}T${clock}Z`;
    const d = new Date(full);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // Fallback: same calendar date as first sample, no overnight roll.
  return sessionStartIso(firstSampleIso, clock) ?? firstSampleIso;
}

export type SiblingEndMarker = {
  time: string;
  plotIso: string;
  sourceChannel: string;
};

/** End time for one A/B/C trial file (explicit end bookmark, else last CSV row). */
export function endTimeForTrial(
  meta: TrialMeta,
  points: SensorPoint[],
): SiblingEndMarker | null {
  if (!points.length) return null;
  const parsed = parseTrialFilename(meta.filename);
  const runLetter = parsed?.run ?? "";
  const firstIso = points[0].time;

  for (const b of meta.bookmarks ?? []) {
    const note = (b.note || "").trim();
    if (!/end/i.test(note) || /start/i.test(note)) continue;
    if (runLetter) {
      const m = note.match(/Trial\s+([ABC])\b/i);
      if (m && m[1].toUpperCase() !== runLetter) continue;
    }
    const plotIso = resolveEndInstant(firstIso, b.time);
    return {
      time: normalizeClockTime(b.time),
      plotIso,
      sourceChannel: parsed?.channel ?? meta.label,
    };
  }

  const last = points[points.length - 1];
  return {
    time: formatClockUtc(new Date(last.time)),
    plotIso: last.time,
    sourceChannel: parsed?.channel ?? meta.label,
  };
}

export type SiblingStartMarker = {
  time: string;
  plotIso: string;
  sourceChannel: string;
};

/** Session start for one A/B/C trial (manual sessionStartTime, else start bookmark). */
export function startTimeForTrial(
  meta: TrialMeta,
  points: SensorPoint[],
): SiblingStartMarker | null {
  if (!points.length) return null;
  const parsed = parseTrialFilename(meta.filename);
  const runLetter = parsed?.run ?? "";
  const firstIso = points[0].time;

  if (meta.sessionStartTime?.trim()) {
    const time = normalizeClockTime(meta.sessionStartTime);
    return {
      time,
      plotIso: resolveStartInstant(meta, firstIso, time),
      sourceChannel: parsed?.channel ?? meta.label,
    };
  }

  for (const b of meta.bookmarks ?? []) {
    const note = (b.note || "").trim();
    if (!/start/i.test(note) || /end/i.test(note)) continue;
    if (runLetter) {
      const m = note.match(/Trial\s+([ABC])\b/i);
      if (m && m[1].toUpperCase() !== runLetter) continue;
    }
    return {
      time: normalizeClockTime(b.time),
      plotIso: b.plotIso ?? resolveStartInstant(meta, firstIso, b.time),
      sourceChannel: parsed?.channel ?? meta.label,
    };
  }

  return null;
}

/**
 * Plot-only "Trial A/B/C start" markers for an X-run trial.
 * Each run letter has its own start time from sibling A/B/C session starts.
 * Source priority per run: amb → ch1 → ch2 → ch3.
 */
export async function computeXRunDynamicStartBookmarks(
  xMeta: TrialMeta,
  allTrials: TrialMeta[],
  loadSeries: (id: string) => Promise<{ meta: TrialMeta; points: SensorPoint[] } | null>,
  seriesCache: Map<string, { meta: TrialMeta; points: SensorPoint[] } | null>,
): Promise<TrialBookmark[]> {
  const xParsed = parseTrialFilename(xMeta.filename);
  if (!xParsed || xParsed.run !== "X") return [];

  const stored = xMeta.bookmarks ?? [];
  const out: TrialBookmark[] = [];

  const byRun = new Map<string, TrialMeta[]>();
  for (const t of allTrials) {
    const p = parseTrialFilename(t.filename);
    if (!p || p.date !== xParsed.date || !p.run || p.run === "X") continue;
    const list = byRun.get(p.run) ?? [];
    list.push(t);
    byRun.set(p.run, list);
  }

  const runLetters = [...byRun.keys()].sort();

  for (const runLetter of runLetters) {
    const candidates = (byRun.get(runLetter) ?? []).sort(
      (a, b) =>
        channelRank(parseTrialFilename(a.filename)!.channel) -
        channelRank(parseTrialFilename(b.filename)!.channel),
    );
    if (!candidates.length) continue;

    let start: SiblingStartMarker | null = null;
    for (const trial of candidates) {
      let cached = seriesCache.get(trial.id);
      if (cached === undefined) {
        cached = await loadSeries(trial.id);
        seriesCache.set(trial.id, cached);
      }
      if (!cached) continue;
      start = startTimeForTrial(cached.meta, cached.points);
      if (start) break;
    }
    if (!start) continue;

    const hasStoredStart = stored.some(
      (b) =>
        clockTimesEqual(b.time, start.time) &&
        /start/i.test(b.note) &&
        !/end/i.test(b.note),
    );
    if (hasStoredStart) continue;

    out.push({
      id: `computed:start:${xParsed.date}:${runLetter}`,
      time: start.time,
      note: `Trial ${runLetter} start (${start.sourceChannel})`,
      plotIso: start.plotIso,
    });
  }

  return out;
}

/**
 * Plot-only "Trial A/B/C end" markers for an X-run trial.
 * One end time per run letter per calendar day, shared across ch1/ch2/amb.
 * Source priority: amb → ch1 → ch2 → ch3.
 */
export async function computeXRunDynamicEndBookmarks(
  xMeta: TrialMeta,
  allTrials: TrialMeta[],
  loadSeries: (id: string) => Promise<{ meta: TrialMeta; points: SensorPoint[] } | null>,
  seriesCache: Map<string, { meta: TrialMeta; points: SensorPoint[] } | null>,
): Promise<TrialBookmark[]> {
  const xParsed = parseTrialFilename(xMeta.filename);
  if (!xParsed || xParsed.run !== "X") return [];

  const stored = xMeta.bookmarks ?? [];
  const out: TrialBookmark[] = [];

  const byRun = new Map<string, TrialMeta[]>();
  for (const t of allTrials) {
    const p = parseTrialFilename(t.filename);
    if (!p || p.date !== xParsed.date || !p.run || p.run === "X") continue;
    const list = byRun.get(p.run) ?? [];
    list.push(t);
    byRun.set(p.run, list);
  }

  const runLetters = [...byRun.keys()].sort();

  for (const runLetter of runLetters) {
    const candidates = (byRun.get(runLetter) ?? []).sort(
      (a, b) =>
        channelRank(parseTrialFilename(a.filename)!.channel) -
        channelRank(parseTrialFilename(b.filename)!.channel),
    );
    if (!candidates.length) continue;

    let end: SiblingEndMarker | null = null;
    for (const trial of candidates) {
      let cached = seriesCache.get(trial.id);
      if (cached === undefined) {
        cached = await loadSeries(trial.id);
        seriesCache.set(trial.id, cached);
      }
      if (!cached?.points.length) continue;
      end = endTimeForTrial(cached.meta, cached.points);
      if (end) break;
    }
    if (!end) continue;

    if (stored.some((b) => clockTimesEqual(b.time, end.time))) continue;

    out.push({
      id: `computed:end:${xParsed.date}:${runLetter}`,
      time: end.time,
      note: `Trial ${runLetter} end (${end.sourceChannel})`,
      plotIso: end.plotIso,
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

export function isComputedEndBookmark(b: TrialBookmark): boolean {
  return b.id.startsWith("computed:end:");
}

export function isComputedStartBookmark(b: TrialBookmark): boolean {
  return b.id.startsWith("computed:start:");
}

export function isComputedBookmark(b: TrialBookmark): boolean {
  return isComputedEndBookmark(b) || isComputedStartBookmark(b);
}

/** Resolve bookmark onto plot x-axis (calendar ISO or aligned minutes). */
export function bookmarkPlotX(
  bookmark: TrialBookmark,
  firstSampleIso: string | undefined,
  mode: "calendar" | "aligned",
  sessionStart: string | null,
): string | number | null {
  const absoluteIso =
    bookmark.plotIso ?? sessionStartIso(firstSampleIso, bookmark.time);
  if (!absoluteIso) return null;
  if (mode === "calendar") return absoluteIso;
  if (!sessionStart) return null;
  return (Date.parse(absoluteIso) - Date.parse(sessionStart)) / 60000;
}
