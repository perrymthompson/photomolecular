/**
 * =============================================================================
 * COMPUTATION MODULE: norm-rate-align.ts
 * Align-mode enums / labels (client-safe; no fs / Node APIs)
 * =============================================================================
 *
 * session — pair on minutes since sessionStartTime
 * trough  — pair on minutes since AH trough (t_start)
 * clock   — pair on absolute wall-clock (epoch ms)
 *
 * Kept separate from trial-time-origins.ts so Client Components can import
 * labels without pulling server-only persistence.
 * =============================================================================
 */

export type NormRateAlignMode = "session" | "trough" | "clock";

export const NORM_RATE_ALIGN_MODES: NormRateAlignMode[] = [
  "session",
  "trough",
  "clock",
];

export function isNormRateAlignMode(v: unknown): v is NormRateAlignMode {
  return v === "session" || v === "trough" || v === "clock";
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
