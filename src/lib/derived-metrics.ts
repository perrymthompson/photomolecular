/**
 * Time-series derivatives used by SensorPlot / EvapRateVsVpdPlot.
 *
 * AH trough (per trial): 5-point centered rolling mean of AH; t_start = time of
 * min(AH_smoothed) within elapsed [0, AH_TROUGH_SEARCH_MINUTES] after the trial
 * session start (never before that start on the trial date). Rates / VPD /
 * Norm_Rate keep only samples at t ≥ t_start.
 *
 * AH_rate: first smooth raw AH with a 7-point centered rolling mean, then
 *   AH_rate = ΔAH_smoothed / Δt (g/m³/min)
 * VPD      = Psat − Pa (kPa)
 * Norm_Rate = AH_rate / VPD; NaN unless VPD > 0.05 kPa
 */

import { vaporPressureDeficitKPa } from "./humidity";
import type { SensorPoint } from "@/types/trial";

/** Search window (elapsed minutes from session start) for the AH trough. */
export const AH_TROUGH_SEARCH_MINUTES = 40;

/** Centered rolling-mean window for AH trough detection (odd). */
export const AH_TROUGH_SMOOTH_WINDOW = 5;

/** Centered rolling-mean window applied to AH before computing dAH/dt. */
export const AH_RATE_AH_SMOOTH_WINDOW = 7;

/** Fallback if trough detection finds no valid samples. */
export const STABILIZATION_TIME_MINUTES = 20;

/** Norm_Rate only when VPD exceeds this (kPa) — avoids division spikes. */
export const VPD_MIN_FOR_NORM_KPA = 0.05;

/**
 * Optional filter for Norm Rate (g/m³/min). Evap-vs-VPD keeps all rates.
 */
export const AH_RATE_MIN_FOR_EVAP_PLOTS = -0.05;

/** Graph B: hard Y bounds for normalized evaporation rate. */
export const NORM_RATE_Y_RANGE: [number, number] = [-2, 2];

export type AhRateOptions = {
  /**
   * Session / exposure start as epoch ms. Elapsed time is measured from this
   * (falls back to the first sample time when omitted).
   */
  sessionStartMs?: number | null;
  /**
   * Explicit ready time (e.g. precomputed AH trough). When omitted, trough
   * detection runs automatically.
   */
  readyAfterMs?: number | null;
  /**
   * If set, skip trough detection and use a fixed delay from session start.
   */
  stabilizeMinutes?: number;
  /** Elapsed-minute window used to search for the AH minimum (default 40). */
  troughSearchMinutes?: number;
  /**
   * If set, rates below this (g/m³/min) become NaN
   * (used by Evap-vs-VPD and Norm Rate plots).
   */
  minAhRate?: number;
};

export type AhTroughResult = {
  /** Absolute UTC instant of the detected AH minimum. */
  troughMs: number;
  troughIso: string;
  troughIndex: number;
  /** Smoothed AH at the trough (g/m³). */
  ahSmoothed: number;
  /** Raw AH at the trough sample (g/m³). */
  ahRaw: number;
  /** Elapsed minutes from session/data origin. */
  elapsedMinutes: number;
};

/**
 * Centered rolling mean (pandas: center=True, min_periods=1).
 * Edge samples average the available neighbors within the window.
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
    // min_periods=1
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
 * Detect when AH finishes its initial drop: min of 5-point centered AH
 * within elapsed [0, searchMinutes] after the trial session start.
 *
 * When `sessionStartMs` is set (trial start on that date), the trough is
 * never earlier than that instant — pre-start samples are ignored.
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
  // Prefer trial session start; otherwise first sample. Hard floor for t_start.
  const floorMs = trialStartMs ?? firstSampleMs;
  if (floorMs == null) return null;

  const ahs = points.map((p) => p.absHumidity);
  const smoothed = centeredRollingMean(ahs, AH_TROUGH_SMOOTH_WINDOW);
  const searchEndMs = floorMs + searchMinutes * 60_000;

  let bestIdx = -1;
  let bestVal = Infinity;
  for (let i = 0; i < points.length; i++) {
    const t = times[i];
    const v = smoothed[i];
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    // Must be at/after this trial's start on its date (never before).
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

/** Resolve the ready-after instant: explicit, fixed delay, or AH trough. */
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

  // Never start rate / evap windows before the trial session start.
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
 * Absolute humidity rate of change (g/m³/min).
 * 1) AH_smoothed = centered 7-point rolling mean of raw AH (min_periods=1)
 * 2) AH_rate = (AH_smoothed_i − AH_smoothed_{i−1}) / Δt_minutes
 * Samples before the AH trough (t_start) are NaN.
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
  const ahSmoothed = centeredRollingMean(
    points.map((p) => p.absHumidity),
    AH_RATE_AH_SMOOTH_WINDOW,
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

  let rates = maskBeforeReady(out, times, readyAfterMs);

  const minRate = options.minAhRate;
  if (minRate != null) {
    rates = rates.map((v) =>
      Number.isFinite(v) && v < minRate ? Number.NaN : v,
    );
  }

  return rates;
}

/** Vapor pressure deficit (kPa); optionally NaN before AH trough (t_start). */
export function vpdSeries(
  points: SensorPoint[],
  options: AhRateOptions = {},
): number[] {
  const vpds = points.map((p) => vaporPressureDeficitKPa(p.rh, p.temp));
  const slice =
    options.readyAfterMs != null ||
    options.sessionStartMs != null ||
    options.stabilizeMinutes != null;
  if (!slice) return vpds;

  const readyAfterMs = resolveReadyAfterMs(points, options);
  const times = points.map((p) => Date.parse(p.time));
  return maskBeforeReady(vpds, times, readyAfterMs);
}

/**
 * Normalized evaporation rate = AH_rate / VPD ((g/m³/min)/kPa).
 * Requires VPD > 0.05 kPa and AH_rate ≥ AH_RATE_MIN_FOR_EVAP_PLOTS.
 * Values outside the display clamp [-2, 2] are dropped as residual spikes.
 */
export function normRateSeries(
  points: SensorPoint[],
  maxGapMs = Infinity,
  options: AhRateOptions = {},
): number[] {
  const rates = ahRateSeries(points, maxGapMs, {
    ...options,
    minAhRate: options.minAhRate ?? AH_RATE_MIN_FOR_EVAP_PLOTS,
  });
  const vpds = vpdSeries(points, options);
  const [yLo, yHi] = NORM_RATE_Y_RANGE;
  return rates.map((rate, i) => {
    if (!Number.isFinite(rate)) return Number.NaN;
    const vpd = vpds[i];
    if (!Number.isFinite(vpd) || vpd <= VPD_MIN_FOR_NORM_KPA) {
      return Number.NaN;
    }
    const norm = rate / vpd;
    if (!Number.isFinite(norm) || norm < yLo || norm > yHi) {
      return Number.NaN;
    }
    return norm;
  });
}

/**
 * Robust [lo, hi] from percentiles so extreme outliers do not dominate axes.
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
