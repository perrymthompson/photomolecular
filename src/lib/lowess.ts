/**
 * LOWESS / locally weighted regression (Cleveland).
 * Span is a fraction of points in the window (matches R loess `span`).
 */
export function lowess(
  x: number[],
  y: number[],
  span = 0.08,
): { x: number[]; y: number[] } {
  const n = x.length;
  if (n === 0) return { x: [], y: [] };
  if (n < 3) return { x: [...x], y: [...y] };

  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]);
  const ys = order.map((i) => y[i]);

  const r = Math.max(2, Math.floor(span * n));
  const fitted = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    let left = i;
    let right = i;
    while (right - left + 1 < r && (left > 0 || right < n - 1)) {
      if (left === 0) right++;
      else if (right === n - 1) left--;
      else if (xs[i] - xs[left - 1] <= xs[right + 1] - xs[i]) left--;
      else right++;
    }
    const h = Math.max(xs[i] - xs[left], xs[right] - xs[i]) || 1;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let j = left; j <= right; j++) {
      const u = Math.abs(xs[j] - xs[i]) / h;
      const w = u >= 1 ? 0 : (1 - u ** 3) ** 3;
      sw += w;
      sx += w * xs[j];
      sy += w * ys[j];
      sxx += w * xs[j] * xs[j];
      sxy += w * xs[j] * ys[j];
    }
    if (sw === 0) {
      fitted[i] = ys[i];
      continue;
    }
    const meanX = sx / sw;
    const meanY = sy / sw;
    const denom = sxx - sw * meanX * meanX;
    const slope = Math.abs(denom) < 1e-12 ? 0 : (sxy - sw * meanX * meanY) / denom;
    fitted[i] = meanY + slope * (xs[i] - meanX);
  }

  return { x: xs, y: fitted };
}

export const LOWESS_SPAN = 0.08;
