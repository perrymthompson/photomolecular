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
 *      - LOESS(RH), LOESS(T) → Tetens VPD for Norm / Evap-vs-VPD
 *
 * SPAN (LOWESS_SPAN)
 * ------------------
 * Fraction of points in each local window. Smaller → hugs raw data more;
 * larger → smoother but can LAG sharp drops (lid-placement AH plunge).
 * Default 0.02 tracks chamber drops much better than the old 0.08.
 *
 * EDGE TRIM (LOESS_EDGE_TRIM_FRAC)
 * --------------------------------
 * LOESS windows are asymmetric near the start/end of a series, which creates
 * boundary distortion (edge bias). That bias is amplified by derivatives
 * (dAH/dt spikes at the ends). After every LOESS fit we set the first and
 * last ~trimFrac of points to NaN so Plotly / downstream charts drop them.
 *
 * VERIFY: with Fit on, the thick AH curve should sit on the faint raw cloud
 * through the initial drop, not trail above it — and dAH/dt should not spike
 * artificially at the very start or end of a trial.
 * =============================================================================
 */

export type LowessResult = {
  /** Sorted x (same permutation as y). */
  x: number[];
  /** Fitted y in sorted-x order (edges NaN-masked). */
  y: number[];
  /** Fitted y aligned to the ORIGINAL input index order (edges NaN-masked). */
  yOriginalOrder: number[];
};

/**
 * Default span for display + analysis.
 * 0.02 ≈ 2% of points in each neighborhood (tracks sharp AH drops).
 */
export const LOWESS_SPAN = 0.02;

/**
 * Fraction of the fitted series length blanked at each end after LOESS.
 * Matches the LOESS window scale (~2–5%); 3% clears asymmetric-window bias
 * without removing too much usable interior.
 */
export const LOESS_EDGE_TRIM_FRAC = 0.03;

/**
 * Set first/last ~trimFrac of points to NaN (LOESS boundary distortion).
 * If the series is too short for a meaningful interior, all values become NaN.
 */
export function maskLoessBoundaryArtifacts(
  values: number[],
  trimFrac: number = LOESS_EDGE_TRIM_FRAC,
): number[] {
  const n = values.length;
  if (n === 0) return [];
  const k = Math.max(1, Math.floor(n * trimFrac));
  const out = values.slice();
  if (2 * k >= n) {
    out.fill(Number.NaN);
    return out;
  }
  for (let i = 0; i < k; i++) out[i] = Number.NaN;
  for (let i = n - k; i < n; i++) out[i] = Number.NaN;
  return out;
}

/**
 * LOWESS / locally weighted regression (Cleveland), then edge-trim.
 * Span is a fraction of points in the window (matches R loess `span`).
 */
export function lowess(
  x: number[],
  y: number[],
  span = LOWESS_SPAN,
  trimFrac = LOESS_EDGE_TRIM_FRAC,
): LowessResult {
  const n = x.length;
  if (n === 0) return { x: [], y: [], yOriginalOrder: [] };
  if (n < 3) {
    const masked = maskLoessBoundaryArtifacts([...y], trimFrac);
    return { x: [...x], y: masked, yOriginalOrder: [...masked] };
  }

  // Sort by x so neighborhoods are contiguous along the time axis.
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]);
  const ys = order.map((i) => y[i]);

  // Window size in number of points (at least 2).
  const r = Math.max(2, Math.floor(span * n));
  const fittedSorted = new Array<number>(n);

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
  }

  // Blank LOESS edge-bias zones so plots / derivatives never show them.
  const yTrimmed = maskLoessBoundaryArtifacts(fittedSorted, trimFrac);
  const yOriginalOrder = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    yOriginalOrder[order[i]] = yTrimmed[i];
  }

  return { x: xs, y: yTrimmed, yOriginalOrder };
}

/**
 * Convenience: LOESS fitted values in the same index order as the inputs,
 * with boundary points NaN-masked. Non-finite (x,y) pairs are skipped in the
 * fit and left as NaN in the output.
 */
export function lowessPreserveOrder(
  x: number[],
  y: number[],
  span = LOWESS_SPAN,
  trimFrac = LOESS_EDGE_TRIM_FRAC,
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

  const { yOriginalOrder } = lowess(xf, yf, span, trimFrac);
  for (let k = 0; k < idx.length; k++) {
    out[idx[k]] = yOriginalOrder[k];
  }
  return out;
}

/**
 * Apply LOESS then trim boundary artifacts (explicit pipeline helper).
 * Equivalent to lowessPreserveOrder; preferred name at call sites that want
 * the trim contract to be obvious.
 */
export function applyLoessAndTrim(
  x: number[],
  y: number[],
  span = LOWESS_SPAN,
  trimFrac = LOESS_EDGE_TRIM_FRAC,
): number[] {
  return lowessPreserveOrder(x, y, span, trimFrac);
}
