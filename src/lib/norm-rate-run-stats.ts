/**
 * Cross-run Norm Rate comparisons (all days, excluding Run X).
 *
 * Blocks
 * ------
 * 1. Light − Dark (per run) — may confound light with hardware
 * 2. Same split by which chamber got Light (ch1/New vs ch2/Old)
 * 3. Hardware: ch1 − ch2 when both chambers share the same condition
 * 4. Angle: 45° − 90° when a run has both Light angles
 * 5. Light−Dark subset by Light angle + Welch test of mean Δ (45 vs 90)
 */

import {
  detectAhTurnaround,
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
import { sessionStartIso } from "@/lib/parse-csv";
import { differenceOnSharedX } from "@/lib/series-diff";
import { parseFilenameParts } from "@/lib/trial-sort";
import type { TrialSeries } from "@/types/trial";

export type PairStatRow = {
  dayKey: string;
  runKey: string;
  runLetter: string;
  /** Positive side of Δ (A in A − B). */
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aChamber: string;
  bChamber: string;
  aPlotLabel: string;
  bPlotLabel: string;
  /** Optional tags for filtering / display. */
  tags: {
    lightAngle?: number | null;
    lightChamber?: string;
    matchedCondition?: "light" | "dark" | "mixed-light";
  };
  stats: DiffSeriesStats;
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
  lightMinusDark: ComparisonBlock;
  /** Light−Dark when Light was on ch1 (New). */
  lightOnCh1: ComparisonBlock;
  /** Light−Dark when Light was on ch2 (Old). */
  lightOnCh2: ComparisonBlock;
  /** ch1 − ch2 with matched Light or matched Dark. */
  hardwareMatched: ComparisonBlock;
  /** 45° − 90° within runs that have both Light angles. */
  angle45Minus90: ComparisonBlock;
  /** Light−Dark restricted to Light @ 45°. */
  lightDarkAngle45: ComparisonBlock;
  /** Light−Dark restricted to Light @ 90°. */
  lightDarkAngle90: ComparisonBlock;
  /** Welch test: mean(Light−Dark|45°) vs mean(Light−Dark|90°) across runs. */
  angleEffectWelch: TwoSampleTTest | null;
  summary: {
    trialCount: number;
    runGroups: number;
    compared: number;
    excludedX: number;
  };
  /** Convenience mirrors for the original table. */
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
 * Aligned Norm Rate series: x = minutes since session start, y = Norm_Rate.
 */
export function alignedNormRateSeries(
  s: TrialSeries,
): { x: number[]; y: number[]; label: string } | null {
  const startIso = sessionStartIso(
    s.points[0]?.time,
    s.meta.sessionStartTime,
  );
  if (!startIso) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;

  const trough = detectAhTurnaround(s.points, startMs);
  const ys = normRateSeries(s.points, Infinity, {
    sessionStartMs: startMs,
    readyAfterMs: trough?.troughMs ?? null,
  });

  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < s.points.length; i++) {
    if (!Number.isFinite(ys[i])) continue;
    const tMs = Date.parse(s.points[i].time);
    if (!Number.isFinite(tMs)) continue;
    x.push((tMs - startMs) / 60_000);
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
  runKey: string;
  runLetter: string;
  series: TrialSeries[];
};

function groupNonXByDayRun(all: TrialSeries[]): {
  groups: RunGroup[];
  excludedX: number;
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
        runKey: parts.runKey,
        runLetter: parts.runLetter,
        series: [],
      };
      map.set(key, g);
    }
    g.series.push(s);
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.dayKey !== b.dayKey) return b.dayKey.localeCompare(a.dayKey);
    return b.runLetter.localeCompare(a.runLetter);
  });

  return { groups, excludedX };
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

function tryPairStats(
  a: TrialSeries,
  b: TrialSeries,
  g: RunGroup,
  tags: PairStatRow["tags"] = {},
): { row: PairStatRow } | { reason: string } {
  const aXY = alignedNormRateSeries(a);
  const bXY = alignedNormRateSeries(b);
  if (!aXY || !bXY) {
    return { reason: "Missing session start or too few Norm Rate samples" };
  }
  const diff = differenceOnSharedX(aXY, bXY);
  if (!diff) return { reason: "No overlapping aligned time range" };
  const stats = diffSeriesStats(diff.y);
  if (!stats) return { reason: "Insufficient finite Δ samples for t-test" };
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
    },
  };
}

/**
 * Pick one Light and one Dark trial in a run.
 * Prefers opposite chambers (typical ch1 Light vs ch2 Dark).
 */
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
  const deg45 = lights.find((s) => lightAngleFromPlotLabel(s.meta.plotLabel) === 45);
  const deg90 = lights.find((s) => lightAngleFromPlotLabel(s.meta.plotLabel) === 90);
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

/**
 * Compute all Norm Rate comparison blocks for non-X day/run groups.
 */
export function computeNormRateRunStats(
  allSeries: TrialSeries[],
): NormRateRunStatsResult {
  const { groups, excludedX } = groupNonXByDayRun(allSeries);

  const lightMinusDark = emptyBlock(
    "Light − Dark",
    "Light − Dark",
    "Within each run: aligned Norm Rate Δ. Confounds light with hardware when chambers differ.",
  );
  const lightOnCh1 = emptyBlock(
    "Light − Dark (Light on ch1 / New)",
    "Light − Dark",
    "Subset where Light was on ch1 (New) and Dark typically on ch2 (Old).",
  );
  const lightOnCh2 = emptyBlock(
    "Light − Dark (Light on ch2 / Old)",
    "Light − Dark",
    "Subset where Light was on ch2 (Old) and Dark typically on ch1 (New). Compare to the ch1 subset: same sign ⇒ light not an artifact of hardware assignment.",
  );
  const hardwareMatched = emptyBlock(
    "Hardware: ch1 − ch2 (matched condition)",
    "ch1 (New) − ch2 (Old)",
    "Only runs where both chambers share Light or both share Dark (angles may differ for Light). Isolates hardware / sensor offset.",
  );
  const angle45Minus90 = emptyBlock(
    "Angle: 45° − 90° (both Light)",
    "Light 45° − Light 90°",
    "Runs with both illumination angles (no Dark in the pair). Isolates angle when chambers differ.",
  );
  const lightDarkAngle45 = emptyBlock(
    "Light − Dark @ 45°",
    "Light(45°) − Dark",
    "Light−Dark pairs where the Light trial is labeled 45°.",
  );
  const lightDarkAngle90 = emptyBlock(
    "Light − Dark @ 90°",
    "Light(90°) − Dark",
    "Light−Dark pairs where the Light trial is labeled 90°.",
  );

  for (const g of groups) {
    // --- Light − Dark ---
    const ld = pickLightDarkPair(g.series);
    if (!ld) {
      lightMinusDark.skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "No Light and Dark pair in this run",
      });
    } else {
      const angle = lightAngleFromPlotLabel(ld.light.meta.plotLabel);
      const result = tryPairStats(ld.light, ld.dark, g, {
        lightAngle: angle,
        lightChamber: ld.light.meta.label,
      });
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

    // --- Hardware matched condition: ch1 − ch2 ---
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
        // Allow both-Light even if angles differ — still same “light on” hardware probe;
        // tag mixed-light so the table can show it.
        const result = tryPairStats(ch1, ch2, g, {
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

    // --- Angle 45 − 90 ---
    const angles = pickAnglePair(g.series);
    if (!angles) {
      angle45Minus90.skipped.push({
        dayKey: g.dayKey,
        runKey: g.runKey,
        reason: "No Light 45° and Light 90° pair",
      });
    } else {
      const result = tryPairStats(angles.deg45, angles.deg90, g, {
        lightAngle: 45,
      });
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

  const rows = lightMinusDark.rows.map(toLegacyRow);

  return {
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
    },
    rows,
    acrossRuns: lightMinusDark.acrossRuns,
    skipped: lightMinusDark.skipped,
  };
}

export { hardwareFromChamber };
