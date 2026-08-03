/**
 * Shared Plotly legend / margin helpers for desktop vs narrow (mobile) screens.
 * Display only — no effect on series math.
 */

import type { Legend } from "plotly.js";

export type PlotLegendOpts = {
  title?: string;
  fontFamily: string;
  fontColor: string;
  isNarrow: boolean;
};

/**
 * Desktop: horizontal legend above the plot (inside paper → PNG-safe).
 * Narrow:  horizontal legend *below* the plot, one entry per row, smaller type.
 */
export function plotlyLegend(opts: PlotLegendOpts): Partial<Legend> {
  const fontSize = opts.isNarrow ? 9 : 11;
  const common = {
    orientation: "h" as const,
    x: 0,
    xanchor: "left" as const,
    bgcolor: "rgba(0,0,0,0)",
    borderwidth: 0,
    xref: "paper" as const,
    yref: "paper" as const,
    font: {
      color: opts.fontColor,
      family: opts.fontFamily,
      size: fontSize,
    },
    tracegroupgap: opts.isNarrow ? 2 : 8,
  };

  if (opts.isNarrow) {
    // entrywidth ≈ full paper width → each legend item wraps to its own row.
    return {
      ...common,
      title: { text: "" },
      y: -0.14,
      yanchor: "top",
      entrywidth: 0.98,
      entrywidthmode: "fraction",
    } as Partial<Legend>;
  }

  return {
    ...common,
    title: { text: opts.title ?? "Trial" },
    y: 1.02,
    yanchor: "bottom",
    entrywidth: 0.3,
    entrywidthmode: "fraction",
  } as Partial<Legend>;
}

/** Margins sized so the legend stays inside the paper on PNG export. */
export function plotlyMargins(
  isNarrow: boolean,
  legendEntryCount = 3,
): { t: number; r: number; b: number; l: number } {
  if (isNarrow) {
    const legendBlock = Math.max(40, legendEntryCount * 15 + 12);
    return { t: 24, r: 8, b: 52 + legendBlock, l: 42 };
  }
  return { t: 110, r: 40, b: 56, l: 72 };
}

export function plotXAxisTitle(
  mode: "calendar" | "aligned" | "trough",
  isNarrow: boolean,
): string {
  if (mode === "aligned") {
    return isNarrow
      ? "Elapsed since session (min)"
      : "Elapsed Time Since Session Start (minutes)";
  }
  if (mode === "trough") {
    return isNarrow
      ? "Elapsed since AH trough (min)"
      : "Elapsed Time Since AH Trough (minutes)";
  }
  return isNarrow ? "Time (UTC)" : "Time";
}
