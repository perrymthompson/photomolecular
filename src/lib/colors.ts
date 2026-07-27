import { channelNumber } from "./humidity";

/** Matches R script: lowest channel # → coral, next → steel blue. */
const OVERRIDES = ["#E2574C", "#4C8FD1"] as const;

/** ggplot2-like hue palette for remaining trials. */
function huePalette(n: number): string[] {
  if (n <= 0) return [];
  const colors: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = Math.round((i * 360) / n + 15) % 360;
    colors.push(`hsl(${h} 65% 55%)`);
  }
  return colors;
}

/**
 * Assign colors by ascending channel number (same rule as the R script).
 */
export function trialColorMap(labels: string[]): Record<string, string> {
  const sorted = [...labels].sort((a, b) => {
    const ca = channelNumber(a);
    const cb = channelNumber(b);
    if (Number.isNaN(ca) && Number.isNaN(cb)) return a.localeCompare(b);
    if (Number.isNaN(ca)) return 1;
    if (Number.isNaN(cb)) return -1;
    return ca - cb;
  });

  const extras = huePalette(Math.max(0, sorted.length - OVERRIDES.length));
  const map: Record<string, string> = {};
  sorted.forEach((label, i) => {
    map[label] = i < OVERRIDES.length ? OVERRIDES[i] : extras[i - OVERRIDES.length];
  });
  return map;
}

export const DARK_THEME = {
  bg: "#1e1f22",
  gridMajor: "#3a3b3f",
  gridMinor: "#2a2b2e",
  text: "#e8e8e8",
  subtext: "#b5b5b8",
  caption: "#8a8a8d",
  paper: "#1e1f22",
} as const;
