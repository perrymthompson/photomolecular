/**
 * Analysis time origins per trial — session start, AH trough, recording start.
 *
 * Persisted to data/analysis-time-origins.json so Norm Rate stats (and future
 * modules) can reuse the same clocks without recomputing trough detection.
 *
 * ALIGNMENT MODES (Norm Rate stats x-axis)
 * ----------------------------------------
 * session — x = minutes since meta.sessionStartTime (protocol t=0)
 * trough  — x = minutes since AH trough (t_start); both trials share “post-lid”
 *           phase even if session clocks differ slightly
 * clock   — x = absolute epoch ms (wall clock); pairs only where both trials
 *           were recording at the same UTC instant (same-run Light/Dark OK;
 *           cross-day usually empty overlap)
 *
 * Norm Rate values themselves still use session floor → trough detection and
 * mask rates before trough; only the *comparison grid* origin changes.
 */

import { promises as fs } from "fs";
import path from "path";
import { detectAhTurnaround } from "@/lib/derived-metrics";
import { sessionStartIso } from "@/lib/parse-csv";
import type { TrialSeries } from "@/types/trial";

export type NormRateAlignMode = "session" | "trough" | "clock";

export const NORM_RATE_ALIGN_MODES: NormRateAlignMode[] = [
  "session",
  "trough",
  "clock",
];

export function isNormRateAlignMode(v: unknown): v is NormRateAlignMode {
  return v === "session" || v === "trough" || v === "clock";
}

/** One trial’s analysis clocks (ISO + HH:MM:SS on the trial day). */
export type TrialTimeOrigins = {
  trialId: string;
  filename: string;
  /** User session / exposure start (already on TrialMeta; echoed here). */
  sessionStartTime: string | null;
  sessionStartIso: string | null;
  sessionStartMs: number | null;
  /**
   * AH trough (t_start): argmin LOESS(AH) in [sessionStart, +40 min]
   * (or first sample floor if no session start).
   */
  ahTroughTime: string | null;
  ahTroughIso: string | null;
  ahTroughMs: number | null;
  /** First finite sample — wall-clock recording start for this CSV. */
  recordingStartTime: string | null;
  recordingStartIso: string | null;
  recordingStartMs: number | null;
  updatedAt: string;
};

type OriginsFile = {
  version: 1;
  updatedAt: string;
  byTrialId: Record<string, TrialTimeOrigins>;
};

const ORIGINS_PATH = path.join(
  process.cwd(),
  "data",
  "analysis-time-origins.json",
);

function formatClockUtc(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Compute session / AH-trough / recording-start origins for one loaded series. */
export function computeTrialTimeOrigins(s: TrialSeries): TrialTimeOrigins {
  const firstIso = s.points[0]?.time ?? null;
  const recordingStartMs =
    firstIso && Number.isFinite(Date.parse(firstIso))
      ? Date.parse(firstIso)
      : null;
  const recordingStartIso =
    recordingStartMs != null ? new Date(recordingStartMs).toISOString() : null;

  const sessionIso = sessionStartIso(
    firstIso ?? undefined,
    s.meta.sessionStartTime,
  );
  const sessionStartMs =
    sessionIso && Number.isFinite(Date.parse(sessionIso))
      ? Date.parse(sessionIso)
      : null;

  const trough = detectAhTurnaround(s.points, sessionStartMs);
  const ahTroughMs = trough?.troughMs ?? null;
  const ahTroughIso =
    ahTroughMs != null ? new Date(ahTroughMs).toISOString() : null;

  return {
    trialId: s.meta.id,
    filename: s.meta.filename,
    sessionStartTime: s.meta.sessionStartTime,
    sessionStartIso: sessionIso,
    sessionStartMs,
    ahTroughTime: ahTroughMs != null ? formatClockUtc(ahTroughMs) : null,
    ahTroughIso,
    ahTroughMs,
    recordingStartTime:
      recordingStartMs != null ? formatClockUtc(recordingStartMs) : null,
    recordingStartIso,
    recordingStartMs,
    updatedAt: new Date().toISOString(),
  };
}

export async function readTrialTimeOriginsFile(): Promise<OriginsFile> {
  try {
    const raw = await fs.readFile(ORIGINS_PATH, "utf8");
    const parsed = JSON.parse(raw) as OriginsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.byTrialId) {
      return { version: 1, updatedAt: new Date().toISOString(), byTrialId: {} };
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      byTrialId: parsed.byTrialId,
    };
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), byTrialId: {} };
  }
}

export async function writeTrialTimeOrigins(
  origins: TrialTimeOrigins[],
): Promise<OriginsFile> {
  const existing = await readTrialTimeOriginsFile();
  const byTrialId = { ...existing.byTrialId };
  for (const o of origins) {
    byTrialId[o.trialId] = o;
  }
  const next: OriginsFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    byTrialId,
  };
  await fs.mkdir(path.dirname(ORIGINS_PATH), { recursive: true });
  await fs.writeFile(ORIGINS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * Resolve the x-axis origin (ms) for pairing under an align mode.
 * clock → null (caller uses absolute sample times as x).
 */
export function originMsForAlignMode(
  origins: TrialTimeOrigins,
  mode: NormRateAlignMode,
): number | null {
  if (mode === "session") return origins.sessionStartMs;
  if (mode === "trough") return origins.ahTroughMs;
  return null;
}

export function alignModeLabel(mode: NormRateAlignMode): string {
  switch (mode) {
    case "session":
      return "Session start";
    case "trough":
      return "AH trough";
    case "clock":
      return "Clock time";
  }
}
