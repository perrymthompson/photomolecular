/**
 * Cross-run Norm Rate comparison stats (all days, excluding Run X).
 *
 * For each discrete A/B/C run that has both a Light and a Dark trial:
 *   1. Build aligned Norm_Rate series (elapsed minutes from session start)
 *   2. Δ(t) = Norm_Rate_Light(t) − Norm_Rate_Dark(t) on the shared overlap
 *   3. One-sample t-test of Δ vs 0 (same as the plot Diff stats panel)
 *
 * X runs are excluded — they are full-day composites, not exposure trials.
 */

import {
  detectAhTurnaround,
  normRateSeries,
} from "@/lib/derived-metrics";
import {
  diffSeriesStats,
  type DiffSeriesStats,
} from "@/lib/diff-stats";
import { lightConditionFromPlotLabel } from "@/lib/plot-label";
import { sessionStartIso } from "@/lib/parse-csv";
import { differenceOnSharedX } from "@/lib/series-diff";
import { parseFilenameParts } from "@/lib/trial-sort";
import type { TrialSeries } from "@/types/trial";

export type NormRateRunStatRow = {
  dayKey: string;
  runKey: string;
  runLetter: string;
  lightId: string;
  darkId: string;
  lightName: string;
  darkName: string;
  lightChamber: string;
  darkChamber: string;
  lightPlotLabel: string;
  darkPlotLabel: string;
  stats: DiffSeriesStats;
};

export type NormRateRunStatsResult = {
  /** Per day/run Light − Dark Norm Rate comparisons. */
  rows: NormRateRunStatRow[];
  /**
   * One-sample t-test across per-run mean Δ values (each run = one obs).
   * Null if fewer than 2 successful run comparisons.
   */
  acrossRuns: DiffSeriesStats | null;
  /** Runs skipped (no pair, missing session start, etc.). */
  skipped: { dayKey: string; runKey: string; reason: string }[];
  /** Counts for the table header. */
  summary: {
    trialCount: number;
    runGroups: number;
    compared: number;
    excludedX: number;
  };
};

function trialShortName(s: TrialSeries): string {
  const short = s.meta.filename.replace(/\.csv$/i, "");
  const pl = s.meta.plotLabel?.trim();
  return pl ? `${s.meta.label} · ${pl}` : `${s.meta.label} · ${short}`;
}

/**
 * Aligned Norm Rate series: x = minutes since session start, y = Norm_Rate.
 * Requires sessionStartTime. Returns null if too few finite samples.
 */
export function alignedNormRateSeries(
  s: TrialSeries,
): { x: number[]; y: number[]; label: string } | null {
  const startIso = sessionStartIso(
    s.points[0]?.time,
    s.meta.sessionStartTime,
  );
  if (!startIso) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;

  const trough = detectAhTurnaround(s.points, startMs);
  const ys = normRateSeries(s.points, Infinity, {
    sessionStartMs: startMs,
    readyAfterMs: trough?.troughMs ?? null,
  });

  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < s.points.length; i++) {
    if (!Number.isFinite(ys[i])) continue;
    const tMs = Date.parse(s.points[i].time);
    if (!Number.isFinite(tMs)) continue;
    x.push((tMs - startMs) / 60_000);
    y.push(ys[i]);
  }
  if (x.length < 2) return null;

  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return {
    x: order.map((i) => x[i]),
    y: order.map((i) => y[i]),
    label: trialShortName(s),
  };
}

type RunGroup = {
  dayKey: string;
  runKey: string;
  runLetter: string;
  series: TrialSeries[];
};

function groupNonXByDayRun(all: TrialSeries[]): {
  groups: RunGroup[];
  excludedX: number;
} {
  const map = new Map<string, RunGroup>();
  let excludedX = 0;

  for (const s of all) {
    const parts = parseFilenameParts(s.meta.filename);
    if (parts.runLetter === "X") {
      excludedX += 1;
      continue;
    }
    const key = `${parts.dayKey}|${parts.runLetter || parts.runKey}`;
    let g = map.get(key);
    if (!g) {
      g = {
        dayKey: parts.dayKey,
        runKey: parts.runKey,
        runLetter: parts.runLetter,
        series: [],
      };
      map.set(key, g);
    }
    g.series.push(s);
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.dayKey !== b.dayKey) return b.dayKey.localeCompare(a.dayKey);
    return b.runLetter.localeCompare(a.runLetter);
  });

  return { groups, excludedX };
}

/**
 * Pick one Light and one Dark trial in a run.
 * Prefers opposite chambers (typical ch1 Light vs ch2 Dark).
 */
export function pickLightDarkPair(
  series: TrialSeries[],
): { light: TrialSeries; dark: TrialSeries } | null {
  const lights = series.filter(
    (s) => lightConditionFromPlotLabel(s.meta.plotLabel) === "light",
  );
  const darks = series.filter(
    (s) => lightConditionFromPlotLabel(s.meta.plotLabel) === "dark",
  );
  if (lights.length === 0 || darks.length === 0) return null;

  for (const light of lights) {
    const opposite = darks.find((d) => d.meta.label !== light.meta.label);
    if (opposite) return { light, dark: opposite };
  }
  return { light: lights[0], dark: darks[0] };
}

/**
 * Compute Norm Rate Light−Dark stats for every non-X day/run group.
 */
export function computeNormRateRunStats(
  allSeries: TrialSeries[],
): NormRateRunStatsResult {
  const { groups, excludedX } = groupNonXByDayRun(allSeries);
  const rows: NormRateRunStatRow[] = [];
  const skipped: NormRateRunStatsResult["skipped"] = [];

  for (const g of groups) {
    const pair = pickLightDarkPair(g.series);
    if (!pair) {
      skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "No Light and Dark pair in this run",
      });
      continue;
    }

    const lightXY = alignedNormRateSeries(pair.light);
    const darkXY = alignedNormRateSeries(pair.dark);
    if (!lightXY || !darkXY) {
      skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "Missing session start or too few Norm Rate samples",
      });
      continue;
    }

    const diff = differenceOnSharedX(lightXY, darkXY);
    if (!diff) {
      skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "No overlapping aligned time range",
      });
      continue;
    }

    const stats = diffSeriesStats(diff.y);
    if (!stats) {
      skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "Insufficient finite Δ samples for t-test",
      });
      continue;
    }

    rows.push({
      dayKey: g.dayKey,
      runKey: g.runKey,
      runLetter: g.runLetter,
      lightId: pair.light.meta.id,
      darkId: pair.dark.meta.id,
      lightName: lightXY.label,
      darkName: darkXY.label,
      lightChamber: pair.light.meta.label,
      darkChamber: pair.dark.meta.label,
      lightPlotLabel: pair.light.meta.plotLabel ?? "",
      darkPlotLabel: pair.dark.meta.plotLabel ?? "",
      stats,
    });
  }

  const meanDeltas = rows.map((r) => r.stats.meanDelta);
  const acrossRuns = diffSeriesStats(meanDeltas);

  return {
    rows,
    acrossRuns,
    skipped,
    summary: {
      trialCount: allSeries.length,
      runGroups: groups.length,
      compared: rows.length,
      excludedX,
    },
  };
}
