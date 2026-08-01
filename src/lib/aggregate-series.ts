/**
 * Pool multiple trials into one (x, y) cloud for aggregate plotting.
 * X-axis follows PlotMode (clock ms, session minutes, or AH-trough minutes).
 */

import {
  ahRateSeries,
  type AhRateOptions,
  detectAhTurnaround,
  normRateSeries,
  vpdSeries,
} from "@/lib/derived-metrics";
import { PLOT_MAX_POINTS, plotPointIndices } from "@/lib/downsample";
import { LOWESS_SPAN, lowess } from "@/lib/lowess";
import { sessionStartIso } from "@/lib/parse-csv";
import type { NumericSeries } from "@/lib/series-diff";
import type { MetricKey, PlotMode, TrialSeries } from "@/types/trial";

const FULL_RES_GAP_MS = 10_000;
/** Cap LOESS input size so pooled full-res clouds stay interactive. */
const MAX_FIT_POINTS = 3000;
/** Cap scatter markers drawn on the plot. */
const MAX_SCATTER_POINTS = 8000;

function metricValue(
  p: TrialSeries["points"][0],
  key: MetricKey,
): number {
  if (key === "absHumidity") return p.absHumidity;
  if (key === "rh") return p.rh;
  if (key === "temp") return p.temp;
  return Number.NaN;
}

function metricSeries(
  points: TrialSeries["points"],
  key: MetricKey,
  maxGapMs = Infinity,
  rateOptions: AhRateOptions = {},
): number[] {
  if (key === "ahRate") return ahRateSeries(points, maxGapMs, rateOptions);
  if (key === "vpd") return vpdSeries(points, rateOptions);
  if (key === "normRate") return normRateSeries(points, maxGapMs, rateOptions);
  return points.map((p) => metricValue(p, key));
}

function sessionStartMsForSeries(s: TrialSeries): number | null {
  const iso = sessionStartIso(s.points[0]?.time, s.meta.sessionStartTime);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Numeric (x, y) for one trial in the current plot mode.
 * When `fromStartOnly` is true (aggregate default):
 *   - session / AH trough: keep x ≥ 0 (at or after the alignment origin)
 *   - clock time: keep wall time ≥ session start when that time is set
 */
export function trialNumericXY(
  s: TrialSeries,
  metric: MetricKey,
  mode: PlotMode,
  fullResolution: boolean,
  fromStartOnly = true,
): NumericSeries | null {
  const startIso = sessionStartIso(
    s.points[0]?.time,
    s.meta.sessionStartTime,
  );
  if (mode === "aligned" && !startIso) return null;

  const sessionStartMs = sessionStartMsForSeries(s);
  const trough = detectAhTurnaround(s.points, sessionStartMs);
  if (mode === "trough" && !trough) return null;

  const rateOptions: AhRateOptions = {
    sessionStartMs,
    readyAfterMs: trough?.troughMs ?? null,
  };
  const keep = plotPointIndices(
    s.points.length,
    fullResolution,
    PLOT_MAX_POINTS,
  );
  const pts = keep.map((i) => s.points[i]);
  const ys = metricSeries(
    pts,
    metric,
    fullResolution ? FULL_RES_GAP_MS : Infinity,
    rateOptions,
  );
  const startMs = startIso ? Date.parse(startIso) : Number.NaN;
  const troughMs = trough?.troughMs ?? Number.NaN;

  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (!Number.isFinite(ys[i])) continue;
    const tMs = Date.parse(pts[i].time);
    if (!Number.isFinite(tMs)) continue;
    let xv: number;
    if (mode === "calendar") xv = tMs;
    else if (mode === "trough") xv = (tMs - troughMs) / 60_000;
    else xv = (tMs - startMs) / 60_000;
    if (!Number.isFinite(xv)) continue;

    if (fromStartOnly) {
      if (mode === "aligned" || mode === "trough") {
        if (xv < 0) continue;
      } else if (sessionStartMs != null && Number.isFinite(sessionStartMs)) {
        // Clock mode: only at/after this trial's session start.
        if (tMs < sessionStartMs) continue;
      }
    }

    x.push(xv);
    y.push(ys[i]);
  }
  if (x.length < 2) return null;

  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return {
    x: order.map((i) => x[i]),
    y: order.map((i) => y[i]),
    label: s.meta.plotLabel?.trim() || s.meta.label,
  };
}

export type OverlapRange = { xMin: number; xMax: number };

/**
 * Shared x-window where every listed trial has post-start data for this
 * metric/mode. Overlap is computed after the from-start filter so the fit
 * never uses pre-start samples or non-overlapping tails.
 */
export function commonOverlapRange(
  seriesList: TrialSeries[],
  metric: MetricKey,
  mode: PlotMode,
  fullResolution: boolean,
): OverlapRange | null {
  if (seriesList.length === 0) return null;
  let xMin = -Infinity;
  let xMax = Infinity;
  for (const s of seriesList) {
    const one = trialNumericXY(s, metric, mode, fullResolution, true);
    if (!one || one.x.length < 2) return null;
    xMin = Math.max(xMin, one.x[0]);
    xMax = Math.min(xMax, one.x[one.x.length - 1]);
  }
  if (!(xMax > xMin)) return null;
  // Elapsed modes: never start the shared window before the origin.
  if (mode === "aligned" || mode === "trough") {
    xMin = Math.max(xMin, 0);
  }
  if (!(xMax > xMin)) return null;
  return { xMin, xMax };
}

/**
 * Concatenate points from a set of trials, sorted by x.
 * Uses post-start samples only; when `overlap` is set, further restricts to
 * the shared window where all selected trials have data.
 */
export function poolNumericXY(
  seriesList: TrialSeries[],
  metric: MetricKey,
  mode: PlotMode,
  fullResolution: boolean,
  label: string,
  overlap: OverlapRange | null = null,
): NumericSeries | null {
  const x: number[] = [];
  const y: number[] = [];
  for (const s of seriesList) {
    const one = trialNumericXY(s, metric, mode, fullResolution, true);
    if (!one) continue;
    for (let i = 0; i < one.x.length; i++) {
      const xv = one.x[i];
      if (overlap && (xv < overlap.xMin || xv > overlap.xMax)) continue;
      x.push(xv);
      y.push(one.y[i]);
    }
  }
  if (x.length < 2) return null;
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return {
    x: order.map((i) => x[i]),
    y: order.map((i) => y[i]),
    label,
  };
}

/** Evenly spaced subsample for display / LOESS (preserves order). */
function subsampleIndices(n: number, maxPoints: number): number[] {
  if (n <= maxPoints) {
    return Array.from({ length: n }, (_, i) => i);
  }
  return plotPointIndices(n, false, maxPoints);
}

/** Scatter-ready subsample of a pooled cloud. */
export function scatterSubsample(pooled: NumericSeries): NumericSeries {
  const idx = subsampleIndices(pooled.x.length, MAX_SCATTER_POINTS);
  return {
    x: idx.map((i) => pooled.x[i]),
    y: idx.map((i) => pooled.y[i]),
    label: pooled.label,
  };
}

/**
 * LOESS or exponential fit on the pooled cloud (optionally downsampled).
 *
 * Exponential: y = a · e^(b x) via OLS on (x, ln y) for y > 0.
 * Evaluated on an even grid over the pooled x-span.
 */
export type AggregateFitKind = "loess" | "exp";

/** OLS: ln(y) = c + b x  ⇒  y = exp(c) · exp(b x). Needs y > 0. */
function exponentialFitParams(
  xs: number[],
  ys: number[],
): { a: number; b: number; xMin: number; xMax: number } | null {
  let n = 0;
  let sumX = 0;
  let sumL = 0;
  let sumXX = 0;
  let sumXL = 0;
  let xMin = Infinity;
  let xMax = -Infinity;

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(y > 0)) continue;
    const ly = Math.log(y);
    if (!Number.isFinite(ly)) continue;
    n += 1;
    sumX += x;
    sumL += ly;
    sumXX += x * x;
    sumXL += x * ly;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }

  if (n < 3 || !(xMax > xMin)) return null;
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-18) return null;
  const b = (n * sumXL - sumX * sumL) / denom;
  const c = (sumL - b * sumX) / n;
  const a = Math.exp(c);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(a > 0)) return null;
  return { a, b, xMin, xMax };
}

const EXP_FIT_GRID = 240;

export function fitPooledSeries(
  pooled: NumericSeries,
  kind: AggregateFitKind = "loess",
): NumericSeries | null {
  if (pooled.x.length < 3) return null;
  const idx = subsampleIndices(pooled.x.length, MAX_FIT_POINTS);
  const x = idx.map((i) => pooled.x[i]);
  const y = idx.map((i) => pooled.y[i]);

  if (kind === "exp") {
    const params = exponentialFitParams(x, y);
    if (!params) return null;
    const { a, b, xMin, xMax } = params;
    const outX: number[] = [];
    const outY: number[] = [];
    for (let i = 0; i < EXP_FIT_GRID; i++) {
      const t = i / (EXP_FIT_GRID - 1);
      const xv = xMin + t * (xMax - xMin);
      const yv = a * Math.exp(b * xv);
      if (!Number.isFinite(yv)) continue;
      outX.push(xv);
      outY.push(yv);
    }
    if (outX.length < 2) return null;
    return { x: outX, y: outY, label: pooled.label };
  }

  const fit = lowess(x, y, LOWESS_SPAN);
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < fit.x.length; i++) {
    if (!Number.isFinite(fit.y[i])) continue;
    outX.push(fit.x[i]);
    outY.push(fit.y[i]);
  }
  if (outX.length < 2) return null;
  return { x: outX, y: outY, label: pooled.label };
}
