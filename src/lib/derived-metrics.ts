/**
 * =============================================================================
 * COMPUTATION MODULE: derived-metrics.ts
 * AH trough (t_start), AH_rate = dAH/dt, VPD series, Norm_Rate
 * =============================================================================
 *
 * SMOOTHING POLICY (Norm / Evap analysis)
 * ---------------------------------------
 *   AH_raw     = Magnus(RH_raw, T_raw)            // parse-csv / humidity.ts
 *   AH_fit     = applyLoessAndTrim(time, AH_raw)  // edges → NaN
 *   AH_rate_i  = (AH_fit_i − AH_fit_{i−1}) / Δt_i // Δt in minutes
 *                then edge-trim again (derivatives amplify residual bias)
 *
 *   RH_fit     = applyLoessAndTrim(time, RH_raw)
 *   T_fit      = applyLoessAndTrim(time, T_raw)
 *   VPD_fit    = Tetens(RH_fit, T_fit)            // NOT LOESS(VPD_raw)
 *   Norm_Rate  = AH_rate / VPD_fit                // NaN where either side is
 *
 * WHY LOESS(RH), LOESS(T) THEN VPD — NOT LOESS(VPD)
 * ------------------------------------------------
 * VPD = Psat(T)·(1 − RH/100) is nonlinear in T. Smoothing RH and T first,
 * then applying Tetens, matches the physical inputs; smoothing VPD_raw would
 * mix nonlinear artifacts.
 *
 * TROUGH t_start
 * --------------
 *   t_start = argmin_i AH_fit_i  for t ∈ [sessionStart, sessionStart + 40 min]
 * (skips non-finite / edge-trimmed samples). Rates / Norm are blanked for
 * t < t_start so pre-stabilization lid dynamics do not enter evaporation stats.
 *
 * FILE MAP
 * --------
 * | Quantity     | Function              | Notes                                      |
 * |--------------|-----------------------|--------------------------------------------|
 * | AH raw       | humidity + parse-csv  | stored on SensorPoint.absHumidity          |
 * | AH fit       | applyLoessAndTrim     | LOESS + ~3% edge blank                     |
 * | t_start      | detectAhTurnaround    | min of LOESS(AH) in 0–40 min window        |
 * | AH_rate      | ahRateSeries          | Δ LOESS(AH)/Δt; post-trough; edge-trimmed  |
 * | VPD raw      | vpdSeries(smooth:false) | Tetens(RH_raw, T_raw)                    |
 * | VPD fit      | vpdSeries(smooth:true)  | Tetens(LOESS(RH), LOESS(T)); edges NaN  |
 * | Norm_Rate    | normRateSeries        | AH_rate / VPD_fit                          |
 *
 * VERIFY: AH_rate should be ~0 before trough (NaN), then track the decline;
 * Norm_Rate denominator uses VPD_fit, never raw VPD when smooth:true.
 * =============================================================================
 */

import { vaporPressureDeficitKPa } from "./humidity";
import {
  applyLoessAndTrim,
  LOESS_EDGE_TRIM_FRAC,
  LOWESS_SPAN,
  maskLoessBoundaryArtifacts,
} from "./lowess";
import type { SensorPoint } from "@/types/trial";

/** Elapsed-minute search window after session start for AH trough. */
export const AH_TROUGH_SEARCH_MINUTES = 40;

/**
 * @deprecated Analysis now uses LOESS; kept only for reference / old comments.
 * Was: centered rolling window for trough detection.
 */
export const AH_TROUGH_SMOOTH_WINDOW = 5;

/**
 * @deprecated Analysis now uses LOESS(AH) before Δ/Δt.
 * Was: 7-point centered mean of AH before rate.
 */
export const AH_RATE_AH_SMOOTH_WINDOW = 7;

/** Fallback delay [min] if trough detection finds no candidate samples. */
export const STABILIZATION_TIME_MINUTES = 20;

/**
 * Soft floor for Norm_Rate denominator: if |VPD| is this small, skip the
 * ratio (avoid /0). Not a “negative filter” — only numerical safety.
 */
export const VPD_MIN_FOR_NORM_KPA = 1e-6;

/**
 * @deprecated No longer applied to Norm Rate or Evap-vs-VPD.
 * Previously dropped AH_rate < −0.05 before Norm_Rate.
 */
export const AH_RATE_MIN_FOR_EVAP_PLOTS = -0.05;

/**
 * Optional display hint for Norm Rate Y-axis (SensorPlot may still use
 * padded autorange). Values are NOT dropped from the series anymore.
 */
export const NORM_RATE_Y_RANGE: [number, number] = [-2, 2];

/** Span used for analysis LOESS — must match SensorPlot Fit curves. */
export const ANALYSIS_LOWESS_SPAN = LOWESS_SPAN;

/** Edge blank fraction after LOESS / LOESS-based derivatives. */
export const ANALYSIS_LOESS_EDGE_TRIM_FRAC = LOESS_EDGE_TRIM_FRAC;

export type AhRateOptions = {
  /**
   * Trial session / exposure start as epoch ms (from sessionStartTime + date).
   * Elapsed time and trough floor are measured from this instant.
   * Falls back to first sample time when omitted / null.
   */
  sessionStartMs?: number | null;
  /**
   * Explicit t_start. When set (typical from detectAhTurnaround), skips
   * re-detecting the trough inside resolveReadyAfterMs.
   */
  readyAfterMs?: number | null;
  /**
   * If set, skip trough detection and use fixed delay:
   *   readyAfterMs = sessionStart + stabilizeMinutes
   */
  stabilizeMinutes?: number;
  /** Override AH_TROUGH_SEARCH_MINUTES when detecting trough. */
  troughSearchMinutes?: number;
  /**
   * @deprecated Ignored. Norm Rate / Evap no longer filter by AH_rate sign.
   */
  minAhRate?: number;
  /**
   * When true: VPD = Tetens(LOESS(RH), LOESS(T)) for Norm / Evap analysis.
   * When false (default): VPD = Tetens(RH_raw, T_raw) for SensorPlot faint line.
   */
  smooth?: boolean;
};

export type AhTroughResult = {
  /** Absolute UTC instant of the detected AH minimum (= t_start). */
  troughMs: number;
  troughIso: string;
  troughIndex: number;
  /** LOESS-smoothed AH at the trough [g/m³]. */
  ahSmoothed: number;
  /** Raw (unsmoothed) AH at the same index [g/m³]. */
  ahRaw: number;
  /** Elapsed minutes from session/data floor to trough. */
  elapsedMinutes: number;
};

/**
 * Centered rolling mean — retained for utility / tests; analysis uses LOESS.
 * pandas: rolling(window, min_periods=1, center=True).mean()
 */
export function centeredRollingMean(
  values: number[],
  window: number,
): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n === 0 || window < 1) return out;
  const half = Math.floor(window / 2);

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j++) {
      if (!Number.isFinite(values[j])) continue;
      sum += values[j];
      count += 1;
    }
    if (count > 0) out[i] = sum / count;
  }
  return out;
}

function elapsedOriginMs(
  times: number[],
  sessionStartMs: number | null | undefined,
): number | null {
  if (sessionStartMs != null && Number.isFinite(sessionStartMs)) {
    return sessionStartMs;
  }
  for (const t of times) {
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * LOESS-smoothed Absolute Humidity in original sample order (edges NaN).
 * This is the curve SensorPlot Fit draws for AH (same span + trim).
 */
export function ahLowessSeries(
  points: SensorPoint[],
  span: number = ANALYSIS_LOWESS_SPAN,
): number[] {
  const times = points.map((p) => Date.parse(p.time));
  const ahs = points.map((p) => p.absHumidity);
  return applyLoessAndTrim(times, ahs, span);
}

/**
 * Detect AH turnaround / lid-stabilization trough → t_start.
 *
 * ALGORITHM (same as before, but AH_fit is LOESS not 5-pt rolling mean)
 * --------------------------------------------------------------------
 * 1. floorMs = sessionStartMs if provided, else first sample time.
 * 2. AH_fit = LOWESS(time, AH_raw)
 * 3. Among samples with t ∈ [floorMs, floorMs + searchMinutes]:
 *      i* = argmin AH_fit_i
 * 4. t_start = timestamp of i*
 */
export function detectAhTurnaround(
  points: SensorPoint[],
  sessionStartMs?: number | null,
  searchMinutes: number = AH_TROUGH_SEARCH_MINUTES,
): AhTroughResult | null {
  if (points.length === 0) return null;

  const times = points.map((p) => Date.parse(p.time));
  const firstSampleMs = elapsedOriginMs(times, null);
  const trialStartMs =
    sessionStartMs != null && Number.isFinite(sessionStartMs)
      ? sessionStartMs
      : null;
  const floorMs = trialStartMs ?? firstSampleMs;
  if (floorMs == null) return null;

  const ahs = points.map((p) => p.absHumidity);
  const smoothed = applyLoessAndTrim(times, ahs, ANALYSIS_LOWESS_SPAN);
  const searchEndMs = floorMs + searchMinutes * 60_000;

  let bestIdx = -1;
  let bestVal = Infinity;
  for (let i = 0; i < points.length; i++) {
    const t = times[i];
    const v = smoothed[i];
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (t < floorMs || t > searchEndMs) continue;
    if (v < bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;

  const troughMs = times[bestIdx];
  if (troughMs < floorMs) return null;

  return {
    troughMs,
    troughIso: new Date(troughMs).toISOString(),
    troughIndex: bestIdx,
    ahSmoothed: bestVal,
    ahRaw: ahs[bestIdx],
    elapsedMinutes: (troughMs - floorMs) / 60_000,
  };
}

/** Resolve ready-after instant (trough / fixed delay / fallback). */
export function resolveReadyAfterMs(
  points: SensorPoint[],
  options: AhRateOptions = {},
): number | null {
  const times = points.map((p) => Date.parse(p.time));
  const trialStartMs =
    options.sessionStartMs != null && Number.isFinite(options.sessionStartMs)
      ? options.sessionStartMs
      : null;
  const floorMs = trialStartMs ?? elapsedOriginMs(times, null);

  let ready: number | null = null;

  if (options.readyAfterMs != null && Number.isFinite(options.readyAfterMs)) {
    ready = options.readyAfterMs;
  } else if (options.stabilizeMinutes != null && floorMs != null) {
    ready = floorMs + options.stabilizeMinutes * 60_000;
  } else {
    const trough = detectAhTurnaround(
      points,
      options.sessionStartMs,
      options.troughSearchMinutes ?? AH_TROUGH_SEARCH_MINUTES,
    );
    if (trough) {
      ready = trough.troughMs;
    } else if (floorMs != null) {
      ready = floorMs + STABILIZATION_TIME_MINUTES * 60_000;
    }
  }

  if (ready != null && floorMs != null && ready < floorMs) {
    ready = floorMs;
  }
  return ready;
}

function maskBeforeReady(
  values: number[],
  times: number[],
  readyAfterMs: number | null,
): number[] {
  if (readyAfterMs == null) return values;
  return values.map((v, i) =>
    Number.isFinite(times[i]) && times[i] < readyAfterMs ? Number.NaN : v,
  );
}

/**
 * Absolute humidity rate from the LOESS AH curve [g/m³/min].
 *
 * DISCRETE DERIVATIVE
 * -------------------
 *   AH_fit_i = applyLoessAndTrim(t, AH_raw)
 *   AH_rate_i = (AH_fit_i − AH_fit_{i−1}) / Δt_min
 *             where Δt_min = (t_i − t_{i−1}) / 60000
 *
 * Skips pairs with Δt ≤ 0 or Δt > maxGapMs (sensor outage / full-res gap).
 * Samples with t_i < t_start are left NaN (maskBeforeReady).
 * Then blank LOESS-scale edges again — finite differences amplify any
 * residual boundary bias that survived the first trim on AH_fit.
 *
 * No sign filter (positive and negative rates are kept).
 */
export function ahRateSeries(
  points: SensorPoint[],
  maxGapMs = Infinity,
  options: AhRateOptions = {},
): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n < 2) return out;

  const times = points.map((p) => Date.parse(p.time));
  const readyAfterMs = resolveReadyAfterMs(points, options);
  const ahSmoothed = applyLoessAndTrim(
    times,
    points.map((p) => p.absHumidity),
    ANALYSIS_LOWESS_SPAN,
  );

  for (let i = 1; i < n; i++) {
    const t0 = times[i - 1];
    const t1 = times[i];
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    const dtMs = t1 - t0;
    if (dtMs <= 0 || dtMs > maxGapMs) continue;
    if (readyAfterMs != null && t1 < readyAfterMs) continue;
    const a0 = ahSmoothed[i - 1];
    const a1 = ahSmoothed[i];
    if (!Number.isFinite(a0) || !Number.isFinite(a1)) continue;
    const dtMin = dtMs / 60_000;
    out[i] = (a1 - a0) / dtMin;
  }

  return maskLoessBoundaryArtifacts(
    maskBeforeReady(out, times, readyAfterMs),
    ANALYSIS_LOESS_EDGE_TRIM_FRAC,
  );
}

/**
 * Vapor pressure deficit [kPa].
 *
 *   VPD_raw_i = Tetens(RH_raw, T_raw)     // humidity.vaporPressureDeficitKPa
 *
 *   if options.smooth (Norm / Evap path):
 *     RH_fit = LOWESS(t, RH_raw)
 *     T_fit  = LOWESS(t, T_raw)
 *     VPD_i  = Tetens(RH_fit, T_fit)
 *     // Prefer smoothing sensor inputs before the nonlinear VPD formula
 *     // (not LOESS of VPD_raw).
 *
 * Then mask t < t_start when session/trough options are set.
 *
 * SensorPlot faint VPD: smooth: false.
 * Norm / Evap: smooth: true.
 */
export function vpdSeries(
  points: SensorPoint[],
  options: AhRateOptions = {},
): number[] {
  const times = points.map((p) => Date.parse(p.time));
  let vpds: number[];

  if (options.smooth) {
    const rhFit = applyLoessAndTrim(
      times,
      points.map((p) => p.rh),
      ANALYSIS_LOWESS_SPAN,
    );
    const tFit = applyLoessAndTrim(
      times,
      points.map((p) => p.temp),
      ANALYSIS_LOWESS_SPAN,
    );
    // Tetens of edge-NaN RH/T stays NaN — Plotly drops those points.
    vpds = rhFit.map((rh, i) => vaporPressureDeficitKPa(rh, tFit[i]));
  } else {
    vpds = points.map((p) => vaporPressureDeficitKPa(p.rh, p.temp));
  }

  const slice =
    options.readyAfterMs != null ||
    options.sessionStartMs != null ||
    options.stabilizeMinutes != null;
  if (!slice) return vpds;

  const readyAfterMs = resolveReadyAfterMs(points, options);
  return maskBeforeReady(vpds, times, readyAfterMs);
}

/**
 * Normalized evaporation rate:
 *
 *   Norm_Rate_i = AH_rate_i / VPD_fit_i
 *
 *   AH_rate = Δ LOESS(AH_raw) / Δt
 *   VPD_fit = Tetens(LOESS(RH), LOESS(T))
 *
 * No AH_rate sign filter; no [-2, 2] value drop.
 * Skips non-finite inputs or |VPD| ≤ VPD_MIN_FOR_NORM_KPA (div-by-zero).
 */
export function normRateSeries(
  points: SensorPoint[],
  maxGapMs = Infinity,
  options: AhRateOptions = {},
): number[] {
  const rates = ahRateSeries(points, maxGapMs, options);
  const vpds = vpdSeries(points, { ...options, smooth: true });
  return rates.map((rate, i) => {
    if (!Number.isFinite(rate)) return Number.NaN;
    const vpd = vpds[i];
    if (!Number.isFinite(vpd) || Math.abs(vpd) <= VPD_MIN_FOR_NORM_KPA) {
      return Number.NaN;
    }
    return rate / vpd;
  });
}

/**
 * Robust [lo, hi] from percentiles — DISPLAY ONLY (does not drop data).
 */
export function percentileRange(
  vals: number[],
  loPct = 2,
  hiPct = 98,
  padFrac = 0.08,
): [number, number] {
  const sorted = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [-1, 1];
  if (sorted.length === 1) {
    const v = sorted[0];
    const pad = Math.abs(v) * 0.1 || 0.1;
    return [v - pad, v + pad];
  }
  const at = (pct: number) => {
    const idx = (pct / 100) * (sorted.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.ceil(idx);
    if (i0 === i1) return sorted[i0];
    const t = idx - i0;
    return sorted[i0] * (1 - t) + sorted[i1] * t;
  };
  const lo = at(loPct);
  const hi = at(hiPct);
  const pad = (hi - lo) * padFrac || Math.abs(hi) * padFrac || 0.1;
  return [lo - pad, hi + pad];
}
