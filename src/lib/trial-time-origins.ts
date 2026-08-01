/**
 * =============================================================================
 * COMPUTATION MODULE: trial-time-origins.ts
 * Per-trial analysis clocks (session / AH trough / recording start)
 * =============================================================================
 *
 * WHY
 * ---
 * Cross-run Norm Rate stats and plot alignment need a comparable x-origin
 * per trial. This module *computes* those origins from loaded series;
 * persistence (JSON /tmp on Vercel) is in trial-time-origins-store.ts.
 *
 * ORIGINS
 * -------
 * recordingStart — first SensorPoint timestamp (CSV begin)
 * sessionStart   — sessionStartIso(firstSampleDate, meta.sessionStartTime)
 *                  = calendar date of data + user HH:MM[:SS] (UTC)
 * ahTrough       — detectAhTurnaround(points, sessionStartMs) → t_start
 *
 * ALIGN MODE → x (see also norm-rate-align.ts)
 * --------------------------------------------
 *   session → x = (t − sessionStart) / 60000   [min]
 *   trough  → x = (t − ahTrough) / 60000       [min]
 *   clock   → x = t                            [epoch ms]
 *
 * Note: Norm Rate *y* always uses post-trough AH_rate / VPD_fit regardless
 * of align mode; align mode only changes the pairing x-axis.
 * =============================================================================
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

/** Epoch ms origin for session/trough align; null for clock (use absolute t). */
export function originMsForAlignMode(
  origins: TrialTimeOrigins,
  mode: NormRateAlignMode,
): number | null {
  if (mode === "session") return origins.sessionStartMs;
  if (mode === "trough") return origins.ahTroughMs;
  return null;
}
