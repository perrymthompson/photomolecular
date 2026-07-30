/**
 * Time-series derivatives used by SensorPlot / EvapRateVsVpdPlot.
 *
 * AH_rate  = ΔAH / Δt  (g/m³ per minute), backward difference
 * VPD      = Psat − Pa (kPa) from humidity.ts
 * Norm_Rate = AH_rate / VPD  ((g/m³/min)/kPa); null when |VPD| ≈ 0
 */

import { vaporPressureDeficitKPa } from "./humidity";
import type { SensorPoint } from "@/types/trial";

/** Treat |VPD| below this (kPa) as zero → Norm_Rate is undefined. */
export const VPD_NEAR_ZERO_KPA = 1e-4;

/**
 * Absolute humidity rate of change (g/m³/min).
 * Backward difference: (AH_i − AH_{i−1}) / Δt_minutes.
 * First sample is NaN; breaks across gaps larger than maxGapMs.
 */
export function ahRateSeries(
  points: SensorPoint[],
  maxGapMs = Infinity,
): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n < 2) return out;

  for (let i = 1; i < n; i++) {
    const t0 = Date.parse(points[i - 1].time);
    const t1 = Date.parse(points[i].time);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    const dtMs = t1 - t0;
    if (dtMs <= 0 || dtMs > maxGapMs) continue;
    const dtMin = dtMs / 60_000;
    out[i] =
      (points[i].absHumidity - points[i - 1].absHumidity) / dtMin;
  }
  return out;
}

/** Vapor pressure deficit (kPa) at each sample. */
export function vpdSeries(points: SensorPoint[]): number[] {
  return points.map((p) => vaporPressureDeficitKPa(p.rh, p.temp));
}

/**
 * Normalized evaporation rate = AH_rate / VPD ((g/m³/min)/kPa).
 * Returns NaN when AH_rate is missing or |VPD| is near zero.
 */
export function normRateSeries(
  points: SensorPoint[],
  maxGapMs = Infinity,
): number[] {
  const rates = ahRateSeries(points, maxGapMs);
  const vpds = vpdSeries(points);
  return rates.map((rate, i) => {
    if (!Number.isFinite(rate)) return Number.NaN;
    const vpd = vpds[i];
    if (!Number.isFinite(vpd) || Math.abs(vpd) < VPD_NEAR_ZERO_KPA) {
      return Number.NaN;
    }
    return rate / vpd;
  });
}
