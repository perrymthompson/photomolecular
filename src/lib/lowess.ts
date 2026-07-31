/**
 * =============================================================================
 * COMPUTATION MODULE: lowess.ts
 * LOWESS — locally weighted scatterplot smoothing (Cleveland)
 * =============================================================================
 *
 * USED FOR
 * --------
 * 1. SensorPlot "Fit on" display curves (AH, RH, Temp, VPD, …)
 * 2. Analysis pipeline in derived-metrics.ts:
 *      - AH trough (t_start) from LOESS(AH)
 *      - AH_rate = Δ LOESS(AH) / Δt
 *      - LOESS(VPD) for Evap-vs-VPD x-axis and Norm_Rate denominator
 *
 * SPAN (LOWESS_SPAN)
 * ------------------
 * Fraction of points in each local window. Smaller → hugs raw data more;
 * larger → smoother but can LAG sharp drops (lid-placement AH plunge).
 * Default 0.02 tracks chamber drops much better than the old 0.08 (R lab
 * script used 0.08 for overview plots; analysis needs a tighter fit).
 *
 * VERIFY: with Fit on, the thick AH curve should sit on the faint raw cloud
 * through the initial drop, not trail above it for several minutes.
 * =============================================================================
 */

export type LowessResult = {
  /** Sorted x (same permutation as y). */
  x: number[];
  /** Fitted y in sorted-x order. */
  y: number[];
  /** Fitted y aligned to the ORIGINAL input index order. */
  yOriginalOrder: number[];
};

/**
 * LOWESS / locally weighted regression (Cleveland).
 * Span is a fraction of points in the window (matches R loess `span`).
 */
export function lowess(
  x: number[],
  y: number[],
  span = LOWESS_SPAN,
): LowessResult {
  const n = x.length;
  if (n === 0) return { x: [], y: [], yOriginalOrder: [] };
  if (n < 3) {
    return { x: [...x], y: [...y], yOriginalOrder: [...y] };
  }

  // Sort by x so neighborhoods are contiguous along the time axis.
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]);
  const ys = order.map((i) => y[i]);

  // Window size in number of points (at least 2).
  const r = Math.max(2, Math.floor(span * n));
  const fittedSorted = new Array<number>(n);
  const yOriginalOrder = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    // Expand [left, right] until it covers ~r points around i.
    let left = i;
    let right = i;
    while (right - left + 1 < r && (left > 0 || right < n - 1)) {
      if (left === 0) right++;
      else if (right === n - 1) left--;
      else if (xs[i] - xs[left - 1] <= xs[right + 1] - xs[i]) left--;
      else right++;
    }
    // Bandwidth h = distance to farthest neighbor in the window.
    const h = Math.max(xs[i] - xs[left], xs[right] - xs[i]) || 1;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let j = left; j <= right; j++) {
      const u = Math.abs(xs[j] - xs[i]) / h;
      // Tricube kernel; zero outside the window.
      const w = u >= 1 ? 0 : (1 - u ** 3) ** 3;
      sw += w;
      sx += w * xs[j];
      sy += w * ys[j];
      sxx += w * xs[j] * xs[j];
      sxy += w * xs[j] * ys[j];
    }
    let yi: number;
    if (sw === 0) {
      yi = ys[i];
    } else {
      // Weighted least-squares slope + intercept at xs[i].
      const meanX = sx / sw;
      const meanY = sy / sw;
      const denom = sxx - sw * meanX * meanX;
      const slope =
        Math.abs(denom) < 1e-12 ? 0 : (sxy - sw * meanX * meanY) / denom;
      yi = meanY + slope * (xs[i] - meanX);
    }
    fittedSorted[i] = yi;
    yOriginalOrder[order[i]] = yi;
  }

  return { x: xs, y: fittedSorted, yOriginalOrder };
}

/**
 * Convenience: LOESS fitted values in the same index order as the inputs.
 * Non-finite (x,y) pairs are skipped in the fit and left as NaN in the output.
 */
export function lowessPreserveOrder(
  x: number[],
  y: number[],
  span = LOWESS_SPAN,
): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n === 0) return out;

  const idx: number[] = [];
  const xf: number[] = [];
  const yf: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    idx.push(i);
    xf.push(x[i]);
    yf.push(y[i]);
  }
  if (xf.length === 0) return out;

  const { yOriginalOrder } = lowess(xf, yf, span);
  for (let k = 0; k < idx.length; k++) {
    out[idx[k]] = yOriginalOrder[k];
  }
  return out;
}

/**
 * Default span for display + analysis.
 * 0.02 ≈ 2% of points in each neighborhood (tracks sharp AH drops).
 * Old value 0.08 lagged the lid-placement plunge on chamber trials.
 */
export const LOWESS_SPAN = 0.02;
