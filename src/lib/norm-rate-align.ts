/** Align-mode enums/labels for Norm Rate stats (safe for Client Components). */

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
