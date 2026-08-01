/**
 * =============================================================================
 * COMPUTATION MODULE: diff-stats.ts
 * Paired / one-sample and Welch two-sample t-tests on Δ series
 * =============================================================================
 *
 * PAIRED DIFF STATS (diffSeriesStats) — SensorPlot / Aggregate Diff box
 * ---------------------------------------------------------------------
 * Input: Δ_i = yA(x_i) − yB(x_i) on the shared-x grid (series-diff.ts).
 * Treat finite Δ_i as i.i.d. paired differences (approximation: ignores
 * autocorrelation along the time series — standard for exploratory UI stats).
 *
 *   n     = #{finite Δ}
 *   μ̂    = (1/n) Σ Δ_i
 *   s²    = (1/(n−1)) Σ (Δ_i − μ̂)²     (sample variance)
 *   SE    = s / √n
 *   t     = μ̂ / SE                     (H0: E[Δ] = 0)
 *   df    = n − 1
 *   p     = 2 · (1 − F_{t,df}(|t|))     (two-sided)
 *   CI95  = μ̂ ± t_{1−α/2, df} · SE     (α = 0.05)
 *
 * Equivalent to a paired t-test of A vs B on the aligned grid.
 *
 * WELCH TWO-SAMPLE (welchTwoSampleTTest) — Norm Rate angle effect
 * ----------------------------------------------------------------
 * Compares two independent groups of per-run mean-Δ values
 * (e.g. Light−Dark@45° vs Light−Dark@90°):
 *
 *   t = (μ̂_A − μ̂_B) / √(s²_A/n_A + s²_B/n_B)
 *   df ≈ Welch–Satterthwaite:
 *       (s²_A/n_A + s²_B/n_B)²
 *       / [ (s²_A/n_A)²/(n_A−1) + (s²_B/n_B)²/(n_B−1) ]
 *
 * Student-t CDF uses the regularized incomplete beta (Lentz CF) + Lanczos ln Γ.
 *
 * RATIONALE
 * ---------
 * Plot UI needs an immediate “is mean Δ near zero?” check without shipping a
 * stats library. Autocorrelation means p-values are optimistic — treat them
 * as descriptive, not confirmatory.
 * =============================================================================
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
 * Used for the Student-t CDF identity:
 *   P(|T| > |t|) related to I_{df/(df+t²)}(df/2, 1/2).
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

/**
 * Student-t CDF F(t; df) = P(T ≤ t).
 *
 *   Let x = df / (df + t²). Then
 *   P(|T| > |t|) = I_x(df/2, 1/2),
 *   and F uses the usual sign split around 0.5.
 */
export function studentTCdf(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return Number.NaN;
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const ib = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - ib : ib;
}

/** Two-sided critical value t_{1−α/2, df} via bisection on the CDF. */
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
 * One-sample / paired t-test of mean(Δ) vs 0 (see module header).
 * Non-finite values are dropped before n, μ̂, s are computed.
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

export type TwoSampleTTest = {
  nA: number;
  nB: number;
  meanA: number;
  meanB: number;
  /** meanA − meanB */
  meanDiff: number;
  tStatistic: number;
  pValue: number;
  ci95: [number, number];
  /** Welch–Satterthwaite degrees of freedom. */
  df: number;
};

/**
 * Welch two-sample t-test: H0 mean(a) = mean(b).
 * Used to compare per-run mean Δ between two groups (e.g. 45° vs 90°).
 * See module header for formulas.
 */
export function welchTwoSampleTTest(
  a: number[],
  b: number[],
): TwoSampleTTest | null {
  const A = a.filter(Number.isFinite);
  const B = b.filter(Number.isFinite);
  const nA = A.length;
  const nB = B.length;
  if (nA < 2 || nB < 2) return null;

  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const meanA = mean(A);
  const meanB = mean(B);
  const varSample = (xs: number[], m: number) => {
    let ss = 0;
    for (const v of xs) {
      const d = v - m;
      ss += d * d;
    }
    return ss / (xs.length - 1);
  };
  const vA = varSample(A, meanA);
  const vB = varSample(B, meanB);
  const se2 = vA / nA + vB / nB;
  if (!(se2 > 0)) {
    const meanDiff = meanA - meanB;
    return {
      nA,
      nB,
      meanA,
      meanB,
      meanDiff,
      tStatistic: meanDiff === 0 ? 0 : meanDiff > 0 ? Infinity : -Infinity,
      pValue: meanDiff === 0 ? 1 : 0,
      ci95: [meanDiff, meanDiff],
      df: nA + nB - 2,
    };
  }

  const se = Math.sqrt(se2);
  const meanDiff = meanA - meanB;
  const tStat = meanDiff / se;
  // Welch–Satterthwaite df
  const num = se2 * se2;
  const den = (vA / nA) ** 2 / (nA - 1) + (vB / nB) ** 2 / (nB - 1);
  const df = den > 0 ? num / den : nA + nB - 2;
  const pValue = 2 * (1 - studentTCdf(Math.abs(tStat), df));
  const tCrit = studentTCritical(df, 0.05);
  return {
    nA,
    nB,
    meanA,
    meanB,
    meanDiff,
    tStatistic: tStat,
    pValue: Math.min(1, Math.max(0, pValue)),
    ci95: [meanDiff - tCrit * se, meanDiff + tCrit * se],
    df,
  };
}
