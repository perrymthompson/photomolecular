import { channelNumber } from "./humidity";

/** Site / plot color mode (display only). */
export type ColorMode = "dark" | "light";

/** Distinct colors for up to 30 trials (ggplot-inspired). */
const PALETTE = [
  "#E2574C",
  "#4C8FD1",
  "#5CB85C",
  "#F0AD4E",
  "#9B59B6",
  "#1ABC9C",
  "#E67E22",
  "#3498DB",
  "#E91E63",
  "#00BCD4",
  "#8BC34A",
  "#FF5722",
  "#673AB7",
  "#009688",
  "#FFC107",
  "#795548",
  "#607D8B",
  "#CDDC39",
  "#3F51B5",
  "#FF9800",
  "#4CAF50",
  "#2196F3",
  "#F44336",
  "#9C27B0",
  "#00ACC1",
  "#7CB342",
  "#EF6C00",
  "#5C6BC0",
  "#26A69A",
  "#D81B60",
] as const;

/**
 * One color per trial id. Sorts by channel # when possible so ch1/ch2 keep
 * familiar colors, but every trial gets a unique swatch.
 */
export function trialColorMapById(
  trials: { id: string; label: string }[],
): Record<string, string> {
  const sorted = [...trials].sort((a, b) => {
    const ca = channelNumber(a.label);
    const cb = channelNumber(b.label);
    if (!Number.isNaN(ca) && !Number.isNaN(cb) && ca !== cb) return ca - cb;
    return a.label.localeCompare(b.label);
  });

  const map: Record<string, string> = {};
  sorted.forEach((t, i) => {
    map[t.id] = PALETTE[i % PALETTE.length];
  });
  return map;
}

/** @deprecated use trialColorMapById */
export function trialColorMap(labels: string[]): Record<string, string> {
  const trials = labels.map((label, i) => ({ id: String(i), label }));
  const byId = trialColorMapById(trials);
  const map: Record<string, string> = {};
  labels.forEach((label, i) => {
    map[label] = byId[String(i)];
  });
  return map;
}

/** Plotly paper/plot/axis colors (display only — no effect on series math). */
export type PlotTheme = {
  bg: string;
  gridMajor: string;
  gridMinor: string;
  text: string;
  subtext: string;
  caption: string;
  paper: string;
};

export const PLOT_THEME_DARK: PlotTheme = {
  bg: "#1e1f22",
  gridMajor: "#3a3b3f",
  gridMinor: "#2a2b2e",
  text: "#e8e8e8",
  subtext: "#b5b5b8",
  caption: "#8a8a8d",
  paper: "#1e1f22",
};

export const PLOT_THEME_LIGHT: PlotTheme = {
  bg: "#ffffff",
  gridMajor: "#d8dbe0",
  gridMinor: "#eceef1",
  text: "#1a1b1e",
  subtext: "#5c5f66",
  caption: "#8a8a8d",
  paper: "#ffffff",
};

export function plotThemeFor(mode: ColorMode): PlotTheme {
  return mode === "light" ? PLOT_THEME_LIGHT : PLOT_THEME_DARK;
}

/** @deprecated use plotThemeFor(mode) — kept as dark default for older imports */
export const DARK_THEME = PLOT_THEME_DARK;
