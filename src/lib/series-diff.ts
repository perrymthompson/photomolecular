/**
 * =============================================================================
 * COMPUTATION MODULE: series-diff.ts
 * Shared-x Δ, trapezoidal ∫Δ, cumulative ΣΔ
 * =============================================================================
 *
 * USED BY
 * -------
 * - SensorPlot Diff / Cum Δ (exactly two trials)
 * - AggregateSensorPlot Diff / Cum Δ (Set A fit − Set B fit)
 * - norm-rate-run-stats.ts (per-run Light−Dark, etc.)
 *
 * WHY SHARED-X + LINEAR INTERP
 * ----------------------------
 * Two trials rarely share identical sample clocks. Comparing raw arrays by
 * index would mix different times. Instead we:
 *   1. Restrict to overlap: [max(xA0,xB0), min(xAn,xBn)]
 *   2. Build grid = sorted union of both series’ x inside overlap
 *   3. Interpolate yA, yB at each grid x (no extrapolation)
 *   4. Δ(x) = yA(x) − yB(x)
 *
 * “Same x” means same wall clock (calendar / clock align) OR same elapsed
 * minutes since each trial’s own origin (session / trough) — the caller
 * chooses the x definition before calling these helpers.
 *
 * INTEGRAL vs MEAN Δ
 * ------------------
 * Mean Δ = arithmetic mean of Δ samples (equal weight per grid point).
 * ∫Δ dx / Δt = time-averaged Δ (weights by local spacing). They differ when
 * sampling density varies along x. Both are reported in the Diff stats box.
 *
 * Cum Δ = running sum of Δ_i (not ∫Δ). It accumulates sample-wise differences;
 * denser sampling → larger |Cum Δ| for the same physical curve. Prefer ∫ for
 * time-weighted totals; Cum Δ is a qualitative “running gap” trace.
 * =============================================================================
 */

export type NumericSeries = {
  x: number[];
  y: number[];
  label: string;
};

export type SharedDifference = {
  x: number[];
  y: number[];
  name: string;
};

/**
 * Linear interpolation on a sorted ascending x-grid.
 *
 *   Given x0 ≤ xq ≤ x1 with known y0, y1:
 *     y(xq) = y0·(1−t) + y1·t,   t = (xq − x0) / (x1 − x0)
 *
 * Returns null if xq is outside [xs[0], xs[n−1]] (no extrapolation).
 */
export function interpAt(
  xs: number[],
  ys: number[],
  xq: number,
): number | null {
  const n = xs.length;
  if (n === 0 || xq < xs[0] || xq > xs[n - 1]) return null;
  if (xq === xs[0]) return ys[0];
  if (xq === xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= xq) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo];
  const x1 = xs[hi];
  if (x1 === x0) return ys[lo];
  const t = (xq - x0) / (x1 - x0);
  return ys[lo] * (1 - t) + ys[hi] * t;
}

/**
 * Δ(x) = yA(x) − yB(x) on the overlapping x-range.
 *
 * Grid = sorted unique union of A and B sample x in
 *   [max(A.x[0], B.x[0]), min(A.x[end], B.x[end])].
 * At each grid point, linearly interpolate both series, then subtract.
 */
export function differenceOnSharedX(
  a: NumericSeries,
  b: NumericSeries,
): SharedDifference | null {
  if (a.x.length < 2 || b.x.length < 2) return null;
  const xMin = Math.max(a.x[0], b.x[0]);
  const xMax = Math.min(a.x[a.x.length - 1], b.x[b.x.length - 1]);
  if (!(xMax > xMin)) return null;

  const gridSet = new Set<number>();
  for (const xv of a.x) {
    if (xv >= xMin && xv <= xMax) gridSet.add(xv);
  }
  for (const xv of b.x) {
    if (xv >= xMin && xv <= xMax) gridSet.add(xv);
  }
  const grid = [...gridSet].sort((u, v) => u - v);
  const xOut: number[] = [];
  const yOut: number[] = [];
  for (const xv of grid) {
    const ya = interpAt(a.x, a.y, xv);
    const yb = interpAt(b.x, b.y, xv);
    if (ya === null || yb === null) continue;
    xOut.push(xv);
    yOut.push(ya - yb);
  }
  if (xOut.length < 2) return null;
  return {
    x: xOut,
    y: yOut,
    name: `Δ (${a.label} − ${b.label})`,
  };
}

/**
 * Trapezoidal integral ∫ y dx.
 *
 *   Σ_i  ½ (y_i + y_{i−1}) · Δx_i
 *
 * When xIsEpochMs, Δx is converted to minutes (Δx_ms / 60000) so that
 * integrating a rate in [unit]/min yields [unit], matching elapsed-mode
 * integrals where x is already in minutes.
 */
export function trapzIntegral(
  x: number[],
  y: number[],
  xIsEpochMs = false,
): number | null {
  if (x.length < 2 || y.length !== x.length) return null;
  let sum = 0;
  let any = false;
  for (let i = 1; i < x.length; i++) {
    const dxRaw = x[i] - x[i - 1];
    const dx = xIsEpochMs ? dxRaw / 60_000 : dxRaw;
    if (!(dx > 0)) continue;
    const y0 = y[i - 1];
    const y1 = y[i];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    sum += 0.5 * (y0 + y1) * dx;
    any = true;
  }
  return any ? sum : null;
}

/** Overlap span of a shared-x grid, in minutes. */
export function overlapDurationMinutes(
  x: number[],
  xIsEpochMs = false,
): number | null {
  if (x.length < 2) return null;
  const span = x[x.length - 1] - x[0];
  if (!(span > 0)) return null;
  return xIsEpochMs ? span / 60_000 : span;
}

export type IntegralDiffResult = {
  /** ∫ (yA − yB) dx over overlap (dx in minutes). */
  integralDelta: number;
  /** Length of overlapping x-range in minutes. */
  overlapMinutes: number;
  /** (∫A − ∫B) / overlapMinutes — time-averaged Δ. */
  meanFromIntegral: number;
};

/**
 * ∫_overlap (yA − yB) dx  and  AvgΔ = that / overlapMinutes.
 *
 * Algebraically ∫(yA−yB) = ∫yA − ∫yB on the same grid. Units: if y is Norm Rate
 * [(g/m³/min)/kPa] and dx is minutes → integral has units (g/m³)/kPa.
 */
export function integralDifferenceOnSharedX(
  a: NumericSeries,
  b: NumericSeries,
  xIsEpochMs = false,
): IntegralDiffResult | null {
  const diff = differenceOnSharedX(a, b);
  if (!diff) return null;
  const integralDelta = trapzIntegral(diff.x, diff.y, xIsEpochMs);
  const overlapMinutes = overlapDurationMinutes(diff.x, xIsEpochMs);
  if (
    integralDelta == null ||
    overlapMinutes == null ||
    !(overlapMinutes > 0)
  ) {
    return null;
  }
  return {
    integralDelta,
    overlapMinutes,
    meanFromIntegral: integralDelta / overlapMinutes,
  };
}

/**
 * Cumulative difference (sample-wise running sum).
 *
 *   CumΔ_i = Σ_{k≤i, finite} Δ_k
 *
 * Non-finite Δ samples are skipped (sum does not advance; CumΔ_i stays NaN
 * until the first finite Δ). This is NOT a time integral — see trapzIntegral.
 */
export function cumulativeSum(delta: number[]): number[] {
  const out = new Array<number>(delta.length).fill(Number.NaN);
  let sum = 0;
  let any = false;
  for (let i = 0; i < delta.length; i++) {
    const v = delta[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    any = true;
    out[i] = sum;
  }
  if (!any) return out;
  return out;
}
