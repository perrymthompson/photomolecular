/**
 * Downsample time-series for interactive Plotly charts.
 *
 * Method (when full resolution is OFF):
 *   - NOT "every Nth point" / stride sampling.
 *   - Keeps the **first** and **last** sample always.
 *   - Picks up to (maxPoints − 2) **evenly spaced** interior indices along
 *     the full timeline: index i ≈ round(i × (length−1) / (inner+1)).
 *   - Example: 7,000 samples → 1,800 plotted ≈ one point every ~4 rows on
 *     average, but spaced by position in the series, not a fixed skip count.
 *
 * LOWESS smoothing runs on whichever points are selected (sampled or full).
 */

export function downsampleIndices(length: number, maxPoints: number): number[] {
  if (length <= maxPoints || maxPoints < 3) {
    return Array.from({ length }, (_, i) => i);
  }
  const out: number[] = [0];
  const inner = maxPoints - 2;
  for (let i = 1; i <= inner; i++) {
    const idx = Math.round((i * (length - 1)) / (inner + 1));
    if (idx > out[out.length - 1] && idx < length - 1) out.push(idx);
  }
  out.push(length - 1);
  return out;
}

/** Indices to plot: all points, or evenly spaced subsample capped at maxPoints. */
export function plotPointIndices(
  length: number,
  fullResolution: boolean,
  maxPoints: number,
): number[] {
  if (fullResolution || length <= maxPoints) {
    return Array.from({ length }, (_, i) => i);
  }
  return downsampleIndices(length, maxPoints);
}

export function downsampleParallel<T>(
  values: T[],
  maxPoints: number,
): T[] {
  const idx = downsampleIndices(values.length, maxPoints);
  return idx.map((i) => values[i]);
}

/** Default cap per trial for responsive plots (full resolution uses all points). */
export const PLOT_MAX_POINTS = 1800;
