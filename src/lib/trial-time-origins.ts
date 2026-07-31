/**
 * Analysis time origins per trial — session start, AH trough, recording start.
 *
 * ALIGNMENT MODES — see norm-rate-align.ts
 *
 * Persistence (fs) lives in trial-time-origins-store.ts — server-only.
 */

import { detectAhTurnaround } from "@/lib/derived-metrics";
import type { NormRateAlignMode } from "@/lib/norm-rate-align";
import { sessionStartIso } from "@/lib/parse-csv";
import type { TrialSeries } from "@/types/trial";

export type { NormRateAlignMode } from "@/lib/norm-rate-align";
export {
  NORM_RATE_ALIGN_MODES,
  isNormRateAlignMode,
  alignModeLabel,
} from "@/lib/norm-rate-align";

/** One trial’s analysis clocks (ISO + HH:MM:SS on the trial day). */
export type TrialTimeOrigins = {
  trialId: string;
  filename: string;
  sessionStartTime: string | null;
  sessionStartIso: string | null;
  sessionStartMs: number | null;
  ahTroughTime: string | null;
  ahTroughIso: string | null;
  ahTroughMs: number | null;
  recordingStartTime: string | null;
  recordingStartIso: string | null;
  recordingStartMs: number | null;
  updatedAt: string;
};

export type TrialTimeOriginsFile = {
  version: 1;
  updatedAt: string;
  byTrialId: Record<string, TrialTimeOrigins>;
};

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

export function originMsForAlignMode(
  origins: TrialTimeOrigins,
  mode: NormRateAlignMode,
): number | null {
  if (mode === "session") return origins.sessionStartMs;
  if (mode === "trough") return origins.ahTroughMs;
  return null;
}
