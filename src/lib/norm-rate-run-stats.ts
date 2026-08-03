/**
 * =============================================================================
 * COMPUTATION MODULE: norm-rate-run-stats.ts
 * Cross-run Norm Rate pair comparisons (exclude Run X)
 * =============================================================================
 *
 * PER-TRIAL SERIES (alignedNormRateSeries)
 * ----------------------------------------
 *   y_i = Norm_Rate_i = AH_rate_i / VPD_fit_i     // derived-metrics.ts
 *         (always post-trough; session floor for trough detection)
 *   x_i | session → (t − sessionStart) / 60000
 *       | trough  → (t − ahTrough) / 60000
 *       | clock   → t  [epoch ms]
 *
 * PER-RUN PAIR
 * ------------
 * For each day+run letter (A/B/C…, not X), pick a comparison pair
 * (Light−Dark, ch1−ch2 matched, 45°−90°, …) then:
 *   Δ(x) = differenceOnSharedX(A, B)     // overlap + linear interp
 *   stats = diffSeriesStats(Δ)           // mean, t, CI
 *   ∫Δ, AvgΔ = integralDifferenceOnSharedX
 *
 * IGNORED DAYS
 * ------------
 * Edit NORM_RATE_IGNORED_DAYS to drop whole calendar days before pairing
 * (shown in Skipped as "Day ignored …"). Still excludes Run X as usual.
 *
 * ACROSS RUNS
 * -----------
 * Collect each run’s mean Δ, then diffSeriesStats(those means) → “across
 * runs” one-sample test of whether average run-level Δ is zero.
 *
 * ANGLE EFFECT
 * ------------
 * Welch t-test of {mean Δ Light−Dark @ 45°} vs {mean Δ @ 90°} across runs.
 *
 * RATIONALE
 * ---------
 * Separates confounders: Light−Dark confounds chamber; hardware-matched
 * holds condition fixed; angle blocks isolate illumination geometry.
 * Align mode only remaps x for pairing — y definition never changes.
 * =============================================================================
 */

import {
  normRateSeries,
} from "@/lib/derived-metrics";
import {
  diffSeriesStats,
  welchTwoSampleTTest,
  type DiffSeriesStats,
  type TwoSampleTTest,
} from "@/lib/diff-stats";
import {
  hardwareFromChamber,
  lightAngleFromPlotLabel,
  lightConditionFromPlotLabel,
} from "@/lib/plot-label";
import { differenceOnSharedX, integralDifferenceOnSharedX } from "@/lib/series-diff";
import { parseFilenameParts } from "@/lib/trial-sort";
import {
  alignModeLabel,
  computeTrialTimeOrigins,
  type NormRateAlignMode,
  type TrialTimeOrigins,
} from "@/lib/trial-time-origins";
import type { TrialSeries } from "@/types/trial";

/**
 * Whole calendar days to omit from Norm Rate stats (all comparison blocks).
 * Use the Day column text (e.g. "July 21, 2026") and/or filename dates
 * ("07212026" or "2026-07-21"). Run X and missing Light−Dark pairs still apply.
 */
export const NORM_RATE_IGNORED_DAYS: readonly string[] = [
  "July 21, 2026", "July 22, 2026"
];

function normalizeDayToken(s: string): string {
  return s.trim().toLowerCase();
}

function dayMatchTokens(dayKey: string, date: Date | null): Set<string> {
  const tokens = new Set<string>([normalizeDayToken(dayKey)]);
  if (date && !Number.isNaN(date.getTime())) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    tokens.add(`${y}-${m}-${d}`);
    tokens.add(`${m}${d}${y}`);
  }
  return tokens;
}

function isIgnoredDay(dayKey: string, date: Date | null): boolean {
  if (NORM_RATE_IGNORED_DAYS.length === 0) return false;
  const ignored = NORM_RATE_IGNORED_DAYS.map(normalizeDayToken);
  const tokens = dayMatchTokens(dayKey, date);
  return ignored.some((t) => tokens.has(t));
}

export type PairStatRow = {
  dayKey: string;
  runKey: string;
  runLetter: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aChamber: string;
  bChamber: string;
  aPlotLabel: string;
  bPlotLabel: string;
  tags: {
    lightAngle?: number | null;
    lightChamber?: string;
    matchedCondition?: "light" | "dark" | "mixed-light";
  };
  stats: DiffSeriesStats;
  /** ∫A dx − ∫B dx over overlap (minutes); Norm Rate → (g/m³)/kPa. */
  integralDelta: number | null;
  /** (∫A − ∫B) / overlap minutes — same units as Mean Δ. */
  meanFromIntegral: number | null;
  overlapMinutes: number | null;
};

export type ComparisonBlock = {
  title: string;
  deltaLabel: string;
  note: string;
  rows: PairStatRow[];
  acrossRuns: DiffSeriesStats | null;
  skipped: { dayKey: string; runKey: string; reason: string }[];
};

/** @deprecated Use PairStatRow; kept for older Light−Dark field names in UI. */
export type NormRateRunStatRow = {
  dayKey: string;
  runKey: string;
  runLetter: string;
  lightId: string;
  darkId: string;
  lightName: string;
  darkName: string;
  lightChamber: string;
  darkChamber: string;
  lightPlotLabel: string;
  darkPlotLabel: string;
  lightAngle: number | null;
  stats: DiffSeriesStats;
};

export type NormRateRunStatsResult = {
  alignMode: NormRateAlignMode;
  alignModeLabel: string;
  /** Per-trial session / AH-trough / recording-start clocks used for this run. */
  origins: TrialTimeOrigins[];
  lightMinusDark: ComparisonBlock;
  lightOnCh1: ComparisonBlock;
  lightOnCh2: ComparisonBlock;
  hardwareMatched: ComparisonBlock;
  angle45Minus90: ComparisonBlock;
  lightDarkAngle45: ComparisonBlock;
  lightDarkAngle90: ComparisonBlock;
  angleEffectWelch: TwoSampleTTest | null;
  summary: {
    trialCount: number;
    runGroups: number;
    compared: number;
    excludedX: number;
    /** Run groups dropped via NORM_RATE_IGNORED_DAYS. */
    ignoredDays: number;
  };
  rows: NormRateRunStatRow[];
  acrossRuns: DiffSeriesStats | null;
  skipped: { dayKey: string; runKey: string; reason: string }[];
};

function trialShortName(s: TrialSeries): string {
  const short = s.meta.filename.replace(/\.csv$/i, "");
  const pl = s.meta.plotLabel?.trim();
  return pl ? `${s.meta.label} · ${pl}` : `${s.meta.label} · ${short}`;
}

/**
 * Build Norm Rate series on the comparison x-axis for `alignMode`.
 *
 * y = NormRate (post-trough); x depends on mode (see module header).
 */
export function alignedNormRateSeries(
  s: TrialSeries,
  alignMode: NormRateAlignMode = "session",
  origins?: TrialTimeOrigins,
): { x: number[]; y: number[]; label: string } | null {
  const o = origins ?? computeTrialTimeOrigins(s);
  const sessionStartMs = o.sessionStartMs;
  const troughMs = o.ahTroughMs;

  // Session mode needs a session clock; trough mode needs a detected trough.
  if (alignMode === "session" && sessionStartMs == null) return null;
  if (alignMode === "trough" && troughMs == null) return null;

  const ys = normRateSeries(s.points, Infinity, {
    sessionStartMs,
    readyAfterMs: troughMs,
  });

  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < s.points.length; i++) {
    if (!Number.isFinite(ys[i])) continue;
    const tMs = Date.parse(s.points[i].time);
    if (!Number.isFinite(tMs)) continue;

    let xv: number;
    if (alignMode === "clock") {
      xv = tMs;
    } else if (alignMode === "trough") {
      xv = (tMs - troughMs!) / 60_000;
    } else {
      xv = (tMs - sessionStartMs!) / 60_000;
    }
    if (!Number.isFinite(xv)) continue;
    x.push(xv);
    y.push(ys[i]);
  }
  if (x.length < 2) return null;

  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return {
    x: order.map((i) => x[i]),
    y: order.map((i) => y[i]),
    label: trialShortName(s),
  };
}

type RunGroup = {
  dayKey: string;
  date: Date | null;
  runKey: string;
  runLetter: string;
  series: TrialSeries[];
};

function groupNonXByDayRun(all: TrialSeries[]): {
  groups: RunGroup[];
  excludedX: number;
  ignoredDayGroups: RunGroup[];
} {
  const map = new Map<string, RunGroup>();
  let excludedX = 0;

  for (const s of all) {
    const parts = parseFilenameParts(s.meta.filename);
    if (parts.runLetter === "X") {
      excludedX += 1;
      continue;
    }
    const key = `${parts.dayKey}|${parts.runLetter || parts.runKey}`;
    let g = map.get(key);
    if (!g) {
      g = {
        dayKey: parts.dayKey,
        date: parts.date,
        runKey: parts.runKey,
        runLetter: parts.runLetter,
        series: [],
      };
      map.set(key, g);
    }
    g.series.push(s);
  }

  const groups: RunGroup[] = [];
  const ignoredDayGroups: RunGroup[] = [];
  for (const g of map.values()) {
    if (isIgnoredDay(g.dayKey, g.date)) ignoredDayGroups.push(g);
    else groups.push(g);
  }

  const byDayRun = (a: RunGroup, b: RunGroup) => {
    if (a.dayKey !== b.dayKey) return b.dayKey.localeCompare(a.dayKey);
    return b.runLetter.localeCompare(a.runLetter);
  };
  groups.sort(byDayRun);
  ignoredDayGroups.sort(byDayRun);

  return { groups, excludedX, ignoredDayGroups };
}

function emptyBlock(
  title: string,
  deltaLabel: string,
  note: string,
): ComparisonBlock {
  return { title, deltaLabel, note, rows: [], acrossRuns: null, skipped: [] };
}

function finalizeBlock(block: ComparisonBlock): ComparisonBlock {
  const meanDeltas = block.rows.map((r) => r.stats.meanDelta);
  block.acrossRuns = diffSeriesStats(meanDeltas);
  return block;
}

function missingOriginReason(mode: NormRateAlignMode): string {
  if (mode === "session") return "Missing session start time";
  if (mode === "trough") return "AH trough not detected";
  return "Too few Norm Rate samples";
}

function tryPairStats(
  a: TrialSeries,
  b: TrialSeries,
  g: RunGroup,
  alignMode: NormRateAlignMode,
  originsById: Map<string, TrialTimeOrigins>,
  tags: PairStatRow["tags"] = {},
): { row: PairStatRow } | { reason: string } {
  const aXY = alignedNormRateSeries(a, alignMode, originsById.get(a.meta.id));
  const bXY = alignedNormRateSeries(b, alignMode, originsById.get(b.meta.id));
  if (!aXY || !bXY) {
    return { reason: missingOriginReason(alignMode) };
  }
  const diff = differenceOnSharedX(aXY, bXY);
  if (!diff) {
    return {
      reason:
        alignMode === "clock"
          ? "No overlapping wall-clock time range"
          : "No overlapping aligned time range",
    };
  }
  const stats = diffSeriesStats(diff.y);
  if (!stats) return { reason: "Insufficient finite Δ samples for t-test" };
  const integral = integralDifferenceOnSharedX(
    aXY,
    bXY,
    alignMode === "clock",
  );
  return {
    row: {
      dayKey: g.dayKey,
      runKey: g.runKey,
      runLetter: g.runLetter,
      aId: a.meta.id,
      bId: b.meta.id,
      aName: aXY.label,
      bName: bXY.label,
      aChamber: a.meta.label,
      bChamber: b.meta.label,
      aPlotLabel: a.meta.plotLabel ?? "",
      bPlotLabel: b.meta.plotLabel ?? "",
      tags,
      stats,
      integralDelta: integral?.integralDelta ?? null,
      meanFromIntegral: integral?.meanFromIntegral ?? null,
      overlapMinutes: integral?.overlapMinutes ?? null,
    },
  };
}

export function pickLightDarkPair(
  series: TrialSeries[],
): { light: TrialSeries; dark: TrialSeries } | null {
  const lights = series.filter(
    (s) => lightConditionFromPlotLabel(s.meta.plotLabel) === "light",
  );
  const darks = series.filter(
    (s) => lightConditionFromPlotLabel(s.meta.plotLabel) === "dark",
  );
  if (lights.length === 0 || darks.length === 0) return null;

  for (const light of lights) {
    const opposite = darks.find((d) => d.meta.label !== light.meta.label);
    if (opposite) return { light, dark: opposite };
  }
  return { light: lights[0], dark: darks[0] };
}

function pickChambers(series: TrialSeries[]): {
  ch1: TrialSeries | null;
  ch2: TrialSeries | null;
} {
  const ch1 =
    series.find((s) => s.meta.label.trim().toLowerCase() === "ch1") ?? null;
  const ch2 =
    series.find((s) => s.meta.label.trim().toLowerCase() === "ch2") ?? null;
  return { ch1, ch2 };
}

function pickAnglePair(
  series: TrialSeries[],
): { deg45: TrialSeries; deg90: TrialSeries } | null {
  const lights = series.filter(
    (s) => lightConditionFromPlotLabel(s.meta.plotLabel) === "light",
  );
  const deg45 = lights.find(
    (s) => lightAngleFromPlotLabel(s.meta.plotLabel) === 45,
  );
  const deg90 = lights.find(
    (s) => lightAngleFromPlotLabel(s.meta.plotLabel) === 90,
  );
  if (!deg45 || !deg90) return null;
  return { deg45, deg90 };
}

function toLegacyRow(row: PairStatRow): NormRateRunStatRow {
  return {
    dayKey: row.dayKey,
    runKey: row.runKey,
    runLetter: row.runLetter,
    lightId: row.aId,
    darkId: row.bId,
    lightName: row.aName,
    darkName: row.bName,
    lightChamber: row.aChamber,
    darkChamber: row.bChamber,
    lightPlotLabel: row.aPlotLabel,
    darkPlotLabel: row.bPlotLabel,
    lightAngle: row.tags.lightAngle ?? null,
    stats: row.stats,
  };
}

function alignNote(mode: NormRateAlignMode): string {
  switch (mode) {
    case "session":
      return "X = minutes since each trial’s session start.";
    case "trough":
      return "X = minutes since each trial’s AH trough (t_start).";
    case "clock":
      return "X = wall-clock UTC; overlap only where both CSVs share the same absolute time.";
  }
}

/**
 * Compute all Norm Rate comparison blocks for non-X day/run groups.
 */
export function computeNormRateRunStats(
  allSeries: TrialSeries[],
  alignMode: NormRateAlignMode = "session",
): NormRateRunStatsResult {
  const origins = allSeries.map(computeTrialTimeOrigins);
  const originsById = new Map(origins.map((o) => [o.trialId, o]));
  const { groups, excludedX, ignoredDayGroups } = groupNonXByDayRun(allSeries);
  const xNote = alignNote(alignMode);

  const lightMinusDark = emptyBlock(
    "Light − Dark",
    "Light − Dark",
    `Within each run: Norm Rate Δ on the ${alignModeLabel(alignMode)} grid. ${xNote} Confounds light with hardware when chambers differ.`,
  );
  const lightOnCh1 = emptyBlock(
    "Light − Dark (Light on ch1 / New)",
    "Light − Dark",
    `Subset where Light was on ch1 (New). ${xNote}`,
  );
  const lightOnCh2 = emptyBlock(
    "Light − Dark (Light on ch2 / Old)",
    "Light − Dark",
    `Subset where Light was on ch2 (Old). ${xNote}`,
  );
  const hardwareMatched = emptyBlock(
    "Hardware: ch1 − ch2 (matched condition)",
    "ch1 (New) − ch2 (Old)",
    `Same Light or same Dark on both chambers. ${xNote}`,
  );
  const angle45Minus90 = emptyBlock(
    "Angle: 45° − 90° (both Light)",
    "Light 45° − Light 90°",
    `Runs with both illumination angles. ${xNote}`,
  );
  const lightDarkAngle45 = emptyBlock(
    "Light − Dark @ 45°",
    "Light(45°) − Dark",
    `Light−Dark where Light is 45°. ${xNote}`,
  );
  const lightDarkAngle90 = emptyBlock(
    "Light − Dark @ 90°",
    "Light(90°) − Dark",
    `Light−Dark where Light is 90°. ${xNote}`,
  );

  for (const g of ignoredDayGroups) {
    const skip = {
      dayKey: g.dayKey,
      runKey: g.runKey,
      reason: "Day ignored (NORM_RATE_IGNORED_DAYS)",
    };
    lightMinusDark.skipped.push(skip);
    hardwareMatched.skipped.push(skip);
    angle45Minus90.skipped.push(skip);
  }

  for (const g of groups) {
    const ld = pickLightDarkPair(g.series);
    if (!ld) {
      lightMinusDark.skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "No Light and Dark pair in this run",
      });
    } else {
      const angle = lightAngleFromPlotLabel(ld.light.meta.plotLabel);
      const result = tryPairStats(
        ld.light,
        ld.dark,
        g,
        alignMode,
        originsById,
        {
          lightAngle: angle,
          lightChamber: ld.light.meta.label,
        },
      );
      if ("reason" in result) {
        lightMinusDark.skipped.push({
          dayKey: g.dayKey,
          runKey: g.runKey,
          reason: result.reason,
        });
      } else {
        lightMinusDark.rows.push(result.row);
        const chamber = ld.light.meta.label.trim().toLowerCase();
        if (chamber === "ch1") lightOnCh1.rows.push(result.row);
        else if (chamber === "ch2") lightOnCh2.rows.push(result.row);
        if (angle === 45) lightDarkAngle45.rows.push(result.row);
        else if (angle === 90) lightDarkAngle90.rows.push(result.row);
      }
    }

    const { ch1, ch2 } = pickChambers(g.series);
    if (!ch1 || !ch2) {
      hardwareMatched.skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "Need both ch1 and ch2",
      });
    } else {
      const c1 = lightConditionFromPlotLabel(ch1.meta.plotLabel);
      const c2 = lightConditionFromPlotLabel(ch2.meta.plotLabel);
      if (!c1 || !c2 || c1 !== c2) {
        hardwareMatched.skipped.push({
          dayKey: g.dayKey,
          runKey: g.runKey,
          reason: `Conditions differ (${ch1.meta.plotLabel || "?"} vs ${ch2.meta.plotLabel || "?"})`,
        });
      } else {
        const matched =
          c1 === "dark"
            ? ("dark" as const)
            : lightAngleFromPlotLabel(ch1.meta.plotLabel) ===
                lightAngleFromPlotLabel(ch2.meta.plotLabel)
              ? ("light" as const)
              : ("mixed-light" as const);
        const result = tryPairStats(ch1, ch2, g, alignMode, originsById, {
          matchedCondition: matched,
        });
        if ("reason" in result) {
          hardwareMatched.skipped.push({
            dayKey: g.dayKey,
            runKey: g.runKey,
            reason: result.reason,
          });
        } else {
          hardwareMatched.rows.push(result.row);
        }
      }
    }

    const angles = pickAnglePair(g.series);
    if (!angles) {
      angle45Minus90.skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "No Light 45° and Light 90° pair",
      });
    } else {
      const result = tryPairStats(
        angles.deg45,
        angles.deg90,
        g,
        alignMode,
        originsById,
        { lightAngle: 45 },
      );
      if ("reason" in result) {
        angle45Minus90.skipped.push({
          dayKey: g.dayKey,
          runKey: g.runKey,
          reason: result.reason,
        });
      } else {
        angle45Minus90.rows.push(result.row);
      }
    }
  }

  finalizeBlock(lightMinusDark);
  finalizeBlock(lightOnCh1);
  finalizeBlock(lightOnCh2);
  finalizeBlock(hardwareMatched);
  finalizeBlock(angle45Minus90);
  finalizeBlock(lightDarkAngle45);
  finalizeBlock(lightDarkAngle90);

  const angleEffectWelch = welchTwoSampleTTest(
    lightDarkAngle45.rows.map((r) => r.stats.meanDelta),
    lightDarkAngle90.rows.map((r) => r.stats.meanDelta),
  );

  return {
    alignMode,
    alignModeLabel: alignModeLabel(alignMode),
    origins,
    lightMinusDark,
    lightOnCh1,
    lightOnCh2,
    hardwareMatched,
    angle45Minus90,
    lightDarkAngle45,
    lightDarkAngle90,
    angleEffectWelch,
    summary: {
      trialCount: allSeries.length,
      runGroups: groups.length,
      compared: lightMinusDark.rows.length,
      excludedX,
      ignoredDays: ignoredDayGroups.length,
    },
    rows: lightMinusDark.rows.map(toLegacyRow),
    acrossRuns: lightMinusDark.acrossRuns,
    skipped: lightMinusDark.skipped,
  };
}

export { hardwareFromChamber };
