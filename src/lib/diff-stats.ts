/**
 * One-sample / paired difference statistics for trial Δ series.
 *
 * Treats finite delta[i] as paired differences and tests H0: mean(delta) = 0
 * (equivalent to a paired t-test of A vs B on the aligned grid).
 */

export type DiffSeriesStats = {
  n: number;
  meanDelta: number;
  tStatistic: number;
  /** Two-sided p-value for H0: mean = 0. */
  pValue: number;
  /** 95% CI for mean(delta). */
  ci95: [number, number];
  stdError: number;
};

/**
 * Regularized incomplete beta I_x(a,b) via Lentz continued fraction.
 * Used for the Student-t CDF.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (!(a > 0 && b > 0)) return Number.NaN;

  const lnBeta =
    lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

  // Use symmetry so the continued fraction converges faster.
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  // Lentz continued fraction for incomplete beta.
  const maxIter = 200;
  const eps = 1e-14;
  let m = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;

  for (; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }

  return front * h;
}

/** Lanczos approximation for ln Γ(z), z > 0. */
function lgamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.984369654078761e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** P(T ≤ t) for Student-t with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return Number.NaN;
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const ib = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - ib : ib;
}

/** Two-sided critical value t_{1-α/2, df} via bisection. */
export function studentTCritical(df: number, alpha = 0.05): number {
  if (!(df > 0)) return Number.NaN;
  const target = 1 - alpha / 2;
  let lo = 0;
  let hi = 1;
  while (studentTCdf(hi, df) < target) {
    hi *= 2;
    if (hi > 1e6) return hi;
  }
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (studentTCdf(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Mean(delta), one-sample t vs 0, and 95% CI for the mean.
 * Non-finite values are dropped.
 */
export function diffSeriesStats(delta: number[]): DiffSeriesStats | null {
  const vals: number[] = [];
  for (const v of delta) {
    if (Number.isFinite(v)) vals.push(v);
  }
  const n = vals.length;
  if (n < 2) return null;

  let sum = 0;
  for (const v of vals) sum += v;
  const mean = sum / n;

  let ss = 0;
  for (const v of vals) {
    const d = v - mean;
    ss += d * d;
  }
  const variance = ss / (n - 1);
  const se = Math.sqrt(variance / n);
  const df = n - 1;

  if (!(se > 0)) {
    return {
      n,
      meanDelta: mean,
      tStatistic: mean === 0 ? 0 : mean > 0 ? Infinity : -Infinity,
      pValue: mean === 0 ? 1 : 0,
      ci95: [mean, mean],
      stdError: 0,
    };
  }

  const tStat = mean / se;
  const pValue = 2 * (1 - studentTCdf(Math.abs(tStat), df));
  const tCrit = studentTCritical(df, 0.05);
  return {
    n,
    meanDelta: mean,
    tStatistic: tStat,
    pValue: Math.min(1, Math.max(0, pValue)),
    ci95: [mean - tCrit * se, mean + tCrit * se],
    stdError: se,
  };
}

export function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(3);
}

export function formatSigned(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return "—";
  const body = Math.abs(v).toFixed(digits);
  return v < 0 ? `−${body}` : body;
}
