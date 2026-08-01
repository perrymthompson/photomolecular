/**
 * =============================================================================
 * COMPUTATION MODULE: aggregate-series.ts
 * Multi-trial pooling, shared overlap, LOESS / exponential aggregate fits
 * =============================================================================
 *
 * PURPOSE
 * -------
 * Aggregate Plots page: combine many trials into Set A and Set B clouds,
 * then fit one curve per set and optionally Diff = fitA − fitB.
 *
 * PIPELINE (per metric)
 * ---------------------
 * 1. For each selected trial, build (x, y) via trialNumericXY()
 *      x | calendar → epoch ms (wall clock)
 *        | aligned  → minutes since sessionStartTime
 *        | trough   → minutes since AH trough (t_start)
 *      y | stored AH/RH/Temp, or derived ahRate / vpd / normRate
 *        (same derived-metrics.ts formulas as individual SensorPlot)
 *
 * 2. fromStartOnly (always on for aggregate):
 *      aligned / trough → drop x < 0
 *      calendar         → drop t < sessionStartMs when session start is set
 *    Rationale: lid / exposure “start” is the scientifically relevant origin;
 *    pre-start samples would bias the aggregate fit.
 *
 * 3. commonOverlapRange(all trials in A ∪ B):
 *      xMin = max_i (first x_i),  xMax = min_i (last x_i)
 *      then for elapsed modes: xMin = max(xMin, 0)
 *    Rationale: the average / fit should only use times where EVERY selected
 *    trial contributes data, so no set is dominated by a longer run’s tail.
 *
 * 4. poolNumericXY(set, overlap) → concatenate points inside [xMin, xMax]
 *
 * 5. fitPooledSeries(cloud, kind):
 *      loess → Cleveland LOESS (lowess.ts), span = LOWESS_SPAN
 *      exp   → y = a·e^(b·x) via OLS on (x, ln y) for y > 0
 *
 * Diff / Cum Δ / stats reuse series-diff.ts + diff-stats.ts on the two fits.
 *
 * VERIFY
 * ------
 * - With Fit on + Exp: curve should start at x≈0 (session/trough) and cover
 *   only the shared overlap (not the longest trial’s full length).
 * - AH trough / session modes: no fit points with x < 0.
 * =============================================================================
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
/** Cap LOESS / exp input size so pooled full-res clouds stay interactive. */
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
 *
 * X DEFINITIONS
 * -------------
 *   calendar: x = t_ms                          [epoch ms]
 *   aligned:  x = (t_ms − sessionStart_ms) / 6e4 [min]
 *   trough:   x = (t_ms − trough_ms) / 6e4       [min]
 *
 * fromStartOnly (aggregate default = true)
 * -----------------------------------------
 *   aligned / trough: keep only x ≥ 0
 *   calendar:         keep only t_ms ≥ sessionStart_ms (if known)
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
 * Shared post-start x-window across every listed trial.
 *
 *   xMin = max_i x_i[0],   xMax = min_i x_i[n_i−1]
 *   if mode ∈ {aligned, trough}: xMin ← max(xMin, 0)
 *
 * Returns null if any trial lacks usable post-start data or ranges miss.
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
  if (mode === "aligned" || mode === "trough") {
    xMin = Math.max(xMin, 0);
  }
  if (!(xMax > xMin)) return null;
  return { xMin, xMax };
}

/**
 * Pool points from one set, optionally clipped to a shared overlap window.
 * Output is sorted by x (required by LOESS / Diff).
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

/** Evenly spaced subsample for display / fit (preserves order). */
function subsampleIndices(n: number, maxPoints: number): number[] {
  if (n <= maxPoints) {
    return Array.from({ length: n }, (_, i) => i);
  }
  return plotPointIndices(n, false, maxPoints);
}

/** Scatter-ready subsample of a pooled cloud (display only; fit uses its own cap). */
export function scatterSubsample(pooled: NumericSeries): NumericSeries {
  const idx = subsampleIndices(pooled.x.length, MAX_SCATTER_POINTS);
  return {
    x: idx.map((i) => pooled.x[i]),
    y: idx.map((i) => pooled.y[i]),
    label: pooled.label,
  };
}

export type AggregateFitKind = "loess" | "exp";

/**
 * Exponential fit via log-linear OLS.
 *
 * MODEL
 * -----
 *   y = a · e^(b · x)     (a > 0)
 *
 * LINEARIZATION (only samples with y > 0)
 * ----------------------------------------
 *   ln(y) = c + b·x,   a = e^c
 *
 *   b = (n Σ x ln y − Σx Σ ln y) / (n Σ x² − (Σx)²)
 *   c = (Σ ln y − b Σx) / n
 *
 * Rationale: chamber AH often decays roughly exponentially after the trough;
 * log-linear OLS is closed-form and stable. Negative y (e.g. some rates) are
 * excluded — if fewer than 3 positive points remain, fit fails (null).
 */
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

/**
 * Fit the pooled (already overlap- and post-start-filtered) cloud.
 *
 * loess — Cleveland LOESS + edge trim (same as individual Fit on).
 * exp   — evaluate a·e^(bx) on an even grid over [xMin, xMax] of fit points.
 *
 * Large clouds are evenly subsampled to MAX_FIT_POINTS before fitting
 * (performance only; does not change the overlap / start filters).
 */
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
