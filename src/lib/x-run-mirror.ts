import type { TrialBookmark, TrialMeta } from "@/types/trial";

export type ParsedTrialFilename = {
  channel: string;
  date: string;
  run: string;
};

/** ch1_07242026A_lau.csv → { channel: ch1, date: 07242026, run: A } */
export function parseTrialFilename(filename: string): ParsedTrialFilename | null {
  const base = filename.replace(/^.*[\\/]/, "");
  const m = base.match(/^(ch[12]|amb)_(\d{8})([A-Za-z])_/i);
  if (!m) return null;
  return {
    channel: m[1].toLowerCase(),
    date: m[2],
    run: m[3].toUpperCase(),
  };
}

export function xRunFilename(channel: string, date: string): string {
  return `${channel}_${date}X_lau.csv`;
}

export function normalizeClockTime(time: string): string {
  const t = time.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}

export function clockTimesEqual(a: string, b: string): boolean {
  return normalizeClockTime(a) === normalizeClockTime(b);
}

export function hasBookmarkAtTime(
  bookmarks: TrialBookmark[],
  time: string,
): boolean {
  return bookmarks.some((b) => clockTimesEqual(b.time, time));
}

function mirrorNoteForSessionStart(runLetter: string): string {
  return `Trial ${runLetter} start`;
}

function mirrorNoteForBookmark(runLetter: string, note: string): string {
  const n = note.trim();
  if (/^Trial\s+[ABC]\b/i.test(n)) return n;
  return `Trial ${runLetter}: ${n}`;
}

/** Bookmarks to copy onto the matching X-run trial for this update. */
export function collectMirroredBookmarks(
  source: TrialMeta,
  patch: Partial<Pick<TrialMeta, "sessionStartTime" | "bookmarks">>,
  previousBookmarks: TrialBookmark[],
): { time: string; note: string }[] {
  const parsed = parseTrialFilename(source.filename);
  if (!parsed || parsed.run === "X" || !parsed.run) return [];

  const out: { time: string; note: string }[] = [];

  if (patch.sessionStartTime !== undefined && patch.sessionStartTime) {
    const next = normalizeClockTime(patch.sessionStartTime);
    const prev = source.sessionStartTime
      ? normalizeClockTime(source.sessionStartTime)
      : null;
    if (prev !== next) {
      out.push({
        time: next,
        note: mirrorNoteForSessionStart(parsed.run),
      });
    }
  }

  if (patch.bookmarks !== undefined) {
    const prevIds = new Set(previousBookmarks.map((b) => b.id));
    const added = patch.bookmarks.filter((b) => !prevIds.has(b.id));
    for (const b of added) {
      out.push({
        time: normalizeClockTime(b.time),
        note: mirrorNoteForBookmark(parsed.run, b.note),
      });
    }
  }

  return out;
}

export function mergeMirroredBookmarks(
  existing: TrialBookmark[],
  additions: { time: string; note: string }[],
): TrialBookmark[] | null {
  if (!additions.length) return null;
  const next = [...existing];
  let changed = false;
  for (const add of additions) {
    if (hasBookmarkAtTime(next, add.time)) continue;
    next.push({
      id: crypto.randomUUID(),
      time: normalizeClockTime(add.time),
      note: add.note.trim(),
    });
    changed = true;
  }
  return changed ? next : null;
}

export function findXRunTrial(
  trials: TrialMeta[],
  source: TrialMeta,
): TrialMeta | null {
  const parsed = parseTrialFilename(source.filename);
  if (!parsed) return null;
  const targetName = xRunFilename(parsed.channel, parsed.date);
  return trials.find((t) => t.filename === targetName) ?? null;
}
