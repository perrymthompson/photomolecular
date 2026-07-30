/**
 * Time-series derivatives used by SensorPlot / EvapRateVsVpdPlot.
 *
 * AH_rate  = ΔAH / Δt  (g/m³ per minute), backward difference, then
 *            1-minute trailing rolling mean to suppress derivative noise
 * VPD      = Psat − Pa (kPa) from humidity.ts
 * Norm_Rate = AH_rate / VPD  ((g/m³/min)/kPa); NaN unless VPD > 0.05 kPa
 *
 * Stabilization: rates are NaN until Elapsed Time ≥ STABILIZATION_TIME_MINUTES
 * from session start (or first sample if session start is unset).
 */

import { vaporPressureDeficitKPa } from "./humidity";
import type { SensorPoint } from "@/types/trial";

/** Drop lid-placement transient; rates / evap plots use t ≥ this (minutes). */
export const STABILIZATION_TIME_MINUTES = 20;

/** Norm_Rate only when VPD exceeds this (kPa) — avoids division spikes. */
export const VPD_MIN_FOR_NORM_KPA = 0.05;

/**
 * Evap-vs-VPD and Norm Rate plots drop strongly negative AH rates
 * (g/m³/min) left over from the humidity drop / noise.
 */
export const AH_RATE_MIN_FOR_EVAP_PLOTS = -0.05;

/** Trailing window for AH_rate rolling mean (ms). */
export const AH_RATE_SMOOTH_WINDOW_MS = 60_000;

/** Graph B: hard Y bounds for normalized evaporation rate. */
export const NORM_RATE_Y_RANGE: [number, number] = [-20, 100];

export type AhRateOptions = {
  /**
   * Session / exposure start as epoch ms. Elapsed time is measured from this
   * (falls back to the first sample time when omitted).
   */
  sessionStartMs?: number | null;
  /**
   * Minutes after session start before rates are kept.
   * Defaults to STABILIZATION_TIME_MINUTES.
   */
  stabilizeMinutes?: number;
  /**
   * If set, rates below this (g/m³/min) become NaN
   * (used by Evap-vs-VPD and Norm Rate plots).
   */
  minAhRate?: number;
};

/**
 * Trailing time-window mean of a series, respecting gaps.
 * Only finite samples within [t_i − windowMs, t_i] contribute; the window
 * stops at a gap larger than maxGapMs.
 */
function trailingRollingMean(
  values: number[],
  timesMs: number[],
  windowMs: number,
  maxGapMs: number,
): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(Number.NaN);

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i]) || !Number.isFinite(timesMs[i])) continue;

    const tEnd = timesMs[i];
    const tStart = tEnd - windowMs;
    let sum = 0;
    let count = 0;

    for (let j = i; j >= 0; j--) {
      const t = timesMs[j];
      if (!Number.isFinite(t) || t < tStart) break;
      if (j < i) {
        const dt = timesMs[j + 1] - t;
        if (dt > maxGapMs) break;
      }
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
 * Absolute humidity rate of change (g/m³/min).
 * Raw: (AH_i − AH_{i−1}) / Δt_minutes  → positive when humidity rises.
 * Then smoothed with a 1-minute trailing rolling mean.
 * Samples before the stabilization window are NaN.
 */
export function ahRateSeries(
  points: SensorPoint[],
  maxGapMs = Infinity,
  options: AhRateOptions = {},
): number[] {
  const n = points.length;
  const raw = new Array<number>(n).fill(Number.NaN);
  if (n < 2) return raw;

  const times = points.map((p) => Date.parse(p.time));
  const origin = elapsedOriginMs(times, options.sessionStartMs);
  const stabilizeMin =
    options.stabilizeMinutes ?? STABILIZATION_TIME_MINUTES;
  const readyAfterMs =
    origin != null ? origin + stabilizeMin * 60_000 : null;

  for (let i = 1; i < n; i++) {
    const t0 = times[i - 1];
    const t1 = times[i];
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    const dtMs = t1 - t0;
    if (dtMs <= 0 || dtMs > maxGapMs) continue;
    // Only form rates once the current sample is past stabilization.
    if (readyAfterMs != null && t1 < readyAfterMs) continue;
    const dtMin = dtMs / 60_000;
    raw[i] =
      (points[i].absHumidity - points[i - 1].absHumidity) / dtMin;
  }

  let smoothed = trailingRollingMean(
    raw,
    times,
    AH_RATE_SMOOTH_WINDOW_MS,
    maxGapMs,
  );

  if (readyAfterMs != null) {
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(times[i]) && times[i] < readyAfterMs) {
        smoothed[i] = Number.NaN;
      }
    }
  }

  const minRate = options.minAhRate;
  if (minRate != null) {
    smoothed = smoothed.map((v) =>
      Number.isFinite(v) && v < minRate ? Number.NaN : v,
    );
  }

  return smoothed;
}

/** Vapor pressure deficit (kPa) at each sample. */
export function vpdSeries(points: SensorPoint[]): number[] {
  return points.map((p) => vaporPressureDeficitKPa(p.rh, p.temp));
}

/**
 * Normalized evaporation rate = AH_rate / VPD ((g/m³/min)/kPa).
 * Requires VPD > 0.05 kPa and AH_rate ≥ AH_RATE_MIN_FOR_EVAP_PLOTS.
 * Values outside the display clamp [-20, 100] are dropped as residual spikes.
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
  const vpds = vpdSeries(points);
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
