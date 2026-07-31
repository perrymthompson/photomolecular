/**
 * Shared-x difference and cumulative difference for two trial curves.
 *
 * ALIGNMENT (when sample times / lengths differ)
 * ----------------------------------------------
 * 1. Overlap only: x ∈ [max(startA, startB), min(endA, endB)].
 *    If one trial ends earlier, points after the shorter end are dropped.
 * 2. Grid = sorted union of both trials' x in that overlap.
 * 3. At each grid x, linearly interpolate yA and yB (no extrapolation
 *    outside either series' own range).
 * 4. delta(x) = yA(x) − yB(x).
 *
 * Clock mode uses epoch ms; aligned mode uses minutes since each trial's
 * own session start — so "same x" means same wall clock or same elapsed
 * time, depending on the active plot mode.
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

/** Linear interpolation; null if xq outside [xs[0], xs[n-1]]. xs ascending. */
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
 * Δ(x) = yA(x) − yB(x) on the overlapping x-range of the two displayed curves.
 * Uses the union of sample x in the overlap; linear interp where needed.
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
 * Trapezoidal integral of y over x.
 * When xIsEpochMs, dx is converted to minutes so rate×time units stay consistent.
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

/**
 * ∫_overlap yA dx − ∫_overlap yB dx on the shared grid
 * (= ∫ (yA − yB) dx). xIsEpochMs when x is wall-clock ms.
 */
export function integralDifferenceOnSharedX(
  a: NumericSeries,
  b: NumericSeries,
  xIsEpochMs = false,
): number | null {
  const diff = differenceOnSharedX(a, b);
  if (!diff) return null;
  return trapzIntegral(diff.x, diff.y, xIsEpochMs);
}

/**
 * Running sum of delta: Cumulative_Delta[i] = Σ_{k=0..i} delta[k]
 * (skips non-finite samples without advancing the sum).
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
