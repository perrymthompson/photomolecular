import { channelNumber } from "@/lib/humidity";
import type { TrialMeta } from "@/types/trial";

export type FilenameParts = {
  date: Date | null;
  runLetter: string;
  dayKey: string;
  runKey: string;
};

/** Parse ch1_07242026A_lau.csv → date, run letter, grouping keys. */
export function parseFilenameParts(filename: string): FilenameParts {
  const base = filename.replace(/^.*[\\/]/, "");
  const m = base.match(/_([0-9]{2})([0-9]{2})([0-9]{4})([A-Za-z]?)_/);
  if (!m) {
    return { date: null, runLetter: "", dayKey: "Unknown date", runKey: "Unknown run" };
  }
  const [, mm, dd, yyyy, run] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  const dayKey = Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
  const runLetter = (run ?? "").toUpperCase();
  const runKey = runLetter ? `Run ${runLetter}` : "Run (none)";
  return { date, runLetter, dayKey, runKey };
}

/** Newest day first; within a day, highest run letter first; then channel #. */
export function compareTrials(a: TrialMeta, b: TrialMeta): number {
  const pa = parseFilenameParts(a.filename);
  const pb = parseFilenameParts(b.filename);

  const ta = pa.date?.getTime() ?? 0;
  const tb = pb.date?.getTime() ?? 0;
  if (tb !== ta) return tb - ta;

  if (pa.runLetter !== pb.runLetter) {
    return pb.runLetter.localeCompare(pa.runLetter);
  }

  const ca = channelNumber(a.label);
  const cb = channelNumber(b.label);
  if (!Number.isNaN(ca) && !Number.isNaN(cb) && ca !== cb) return ca - cb;

  return a.filename.localeCompare(b.filename);
}

export function sortTrials(trials: TrialMeta[]): TrialMeta[] {
  return [...trials].sort(compareTrials);
}

export function groupTrialsByDayRun(trials: TrialMeta[]) {
  const sorted = sortTrials(trials);
  const days = new Map<string, Map<string, TrialMeta[]>>();

  for (const trial of sorted) {
    const { dayKey, runKey } = parseFilenameParts(trial.filename);
    if (!days.has(dayKey)) days.set(dayKey, new Map());
    const runs = days.get(dayKey)!;
    if (!runs.has(runKey)) runs.set(runKey, []);
    runs.get(runKey)!.push(trial);
  }

  return [...days.entries()].map(([day, runs]) => ({
    day,
    runs: [...runs.entries()].map(([run, items]) => ({ run, items })),
  }));
}

/** True when selected trials span more than one calendar day or run letter. */
export function selectionSpansMultipleRuns(trials: TrialMeta[]): boolean {
  const keys = new Set(
    trials.map((t) => {
      const p = parseFilenameParts(t.filename);
      return `${p.dayKey}|${p.runLetter}`;
    }),
  );
  return keys.size > 1;
}

export function uniqueDateLabels(trials: TrialMeta[]): string[] {
  return [
    ...new Set(
      trials.map((t) => t.dateLabel ?? parseFilenameParts(t.filename).dayKey).filter(Boolean),
    ),
  ];
}
