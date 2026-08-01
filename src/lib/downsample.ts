/**
 * =============================================================================
 * COMPUTATION MODULE: downsample.ts
 * Evenly spaced index selection for interactive plots
 * =============================================================================
 *
 * WHEN
 * ----
 * fullResolution = false → at most PLOT_MAX_POINTS (1800) indices per trial.
 * fullResolution = true  → every CSV row (gap detection enabled upstream).
 *
 * METHOD (not stride / “every Nth”)
 * ---------------------------------
 * Keep index 0 and n−1 always. Choose up to (maxPoints−2) interior indices
 * evenly in *index space*:
 *
 *   idx_k = round( k · (n−1) / (inner+1) ),  k = 1 … inner
 *
 * Rationale: chamber CSVs are roughly uniform in time, so index-even ≈
 * time-even, without needing to parse timestamps here. Fixed stride would
 * bias toward the start if length is not divisible by stride.
 *
 * Downstream LOESS / rates run on whichever subset is selected — sampled
 * mode is for speed; verify quantitative claims in Full res.
 * =============================================================================
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
