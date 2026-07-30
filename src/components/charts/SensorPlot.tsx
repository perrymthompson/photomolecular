"use client";

/**
 * =============================================================================
 * SensorPlot — chamber sensor plotting (AH / RH / Temp / dAH/dt)
 * =============================================================================
 *
 * This is the main Plotly renderer. Data arrives already computed as
 * TrialSeries[] from the API (`/api/trials/series` → parseChamberCsv).
 *
 * PIPELINE (where each value comes from):
 *   1. CSV rows          → src/lib/parse-csv.ts   (RH + Temp joined by timestamp)
 *   2. Absolute humidity → src/lib/humidity.ts    (Magnus–Tetens, g/m³)
 *   3. This file         → draws raw + LOWESS-smoothed lines, session markers,
 *                          and time bookmarks
 *   4. Smoothing         → src/lib/lowess.ts      (span = 0.08, like R loess)
 *
 * METRICS:
 *   - absHumidity  Absolute Humidity (g/m³)  — computed, not logged directly
 *   - rh           Relative Humidity (%RH)   — from CSV measure type containing "RH"
 *   - temp         Temperature (°C)          — non-RH rows in the CSV
 *   - ahRate       AH Rate dAH/dt (g/m³/min) — finite difference of absHumidity vs time
 *
 * X-AXIS MODES:
 *   - calendar ("Clock time"):  ISO timestamps; Plotly date axis, tick %H:%M
 *   - aligned  ("Align…"):      minutes since sessionStartTime; requires that
 *                               field on every trial
 *
 * BOOKMARKS:
 *   Vertical markers at clock times (HH:MM[:SS] on the trial's data date).
 *   Hover the diamond markers to read the note text; active diamond enlarges
 *   and draws on top. Click a time on the plot to fill the bookmark form.
 * =============================================================================
 */

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type {
  Data,
  Datum,
  Layout,
  LayoutAxis,
  PlotDatum,
  PlotMouseEvent,
  Shape,
} from "plotly.js";
import { DARK_THEME, trialColorMapById } from "@/lib/colors";
import { PLOT_MAX_POINTS, plotPointIndices } from "@/lib/downsample";
import {
  bookmarkPlotX,
  isComputedEndBookmark,
  isComputedStartBookmark,
  plotBookmarksForSeries,
} from "@/lib/x-run-dynamic-bookmarks";
import { LOWESS_SPAN, lowess } from "@/lib/lowess";
import { sessionStartIso } from "@/lib/parse-csv";
import { uniqueDateLabels } from "@/lib/trial-sort";
import type { MetricKey, PlotMode, TrialBookmark, TrialSeries } from "@/types/trial";
import { METRIC_LABELS } from "@/types/trial";

export type PlotTimePick = {
  trialId: string;
  /** Clock time HH:MM:SS for the bookmark form. */
  time: string;
};

type Props = {
  series: TrialSeries[];
  mode: PlotMode;
  /** Which y-panels to show. Combined view passes all four metrics. */
  metrics?: MetricKey[];
  height?: number;
  /** Bumped by parent to force Plotly remount after view/mode changes. */
  plotRevision?: number;
  /** Draw LOWESS smooth curves (default true). */
  showSmooth?: boolean;
  /** Draw bookmark diamonds + guide lines (default true). */
  showBookmarks?: boolean;
  /** Plot every CSV sample (slower); default false uses ~1800 evenly spaced points. */
  fullResolution?: boolean;
  /** Click a point/time → fill bookmark form (does not create a bookmark). */
  onTimePick?: (pick: PlotTimePick) => void;
};

type CurveMeta = {
  trialId: string;
  kind: "raw" | "smooth" | "bookmark";
  color: string;
  metric?: MetricKey;
  bookmarkCount?: number;
};

const BOOKMARK_SIZE = 13;
const END_LINE_COLOR = "#8a8a8d";
const END_LINE_HOVER_STEPS = 28;
const FULL_RES_GAP_MS = 10_000;
const METRIC_SHORT: Record<MetricKey, { short: string; unit: string }> = {
  absHumidity: { short: "AH", unit: "g/m³" },
  rh: { short: "RH", unit: "%RH" },
  temp: { short: "Temp", unit: "°C" },
  ahRate: { short: "dAH/dt", unit: "g/m³/min" },
};

/** Stable fingerprint of sensor points (ignores bookmark/notes edits). */
function pointsFingerprint(series: TrialSeries[]): string {
  return series
    .map((s) => {
      const first = s.points[0]?.time ?? "";
      const last = s.points[s.points.length - 1]?.time ?? "";
      return `${s.meta.id}:${s.points.length}:${first}:${last}:${s.meta.sessionStartTime ?? ""}`;
    })
    .join("|");
}

function bookmarksFingerprint(series: TrialSeries[]): string {
  return series
    .map((s) => {
      const bms = plotBookmarksForSeries(s);
      return `${s.meta.id}:${bms.map((b) => `${b.id}:${b.time}:${b.note}`).join(",")}`;
    })
    .join("|");
}

function plotLabelFingerprint(series: TrialSeries[]): string {
  return series.map((s) => `${s.meta.id}:${s.meta.plotLabel ?? ""}`).join("|");
}

/** Pick the numeric y-value for a stored metric from one sample point. */
function metricValue(p: TrialSeries["points"][0], key: MetricKey): number {
  if (key === "absHumidity") return p.absHumidity;
  if (key === "rh") return p.rh;
  if (key === "temp") return p.temp;
  return Number.NaN;
}

/**
 * First derivative of absolute humidity vs time (g/m³ per minute).
 * Centered differences interior; one-sided at ends. Breaks across large gaps.
 */
function ahRateSeries(
  points: TrialSeries["points"],
  maxGapMs: number,
): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(Number.NaN);
  if (n < 2) return out;

  const times = points.map((p) => Date.parse(p.time));
  const ahs = points.map((p) => p.absHumidity);

  for (let i = 0; i < n; i++) {
    let i0: number;
    let i1: number;
    if (i === 0) {
      i0 = 0;
      i1 = 1;
    } else if (i === n - 1) {
      i0 = n - 2;
      i1 = n - 1;
    } else {
      i0 = i - 1;
      i1 = i + 1;
    }

    const t0 = times[i0];
    const t1 = times[i1];
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    const dtMs = t1 - t0;
    const spanSteps = i1 - i0;
    const maxAllowed = Number.isFinite(maxGapMs)
      ? maxGapMs * Math.max(1, spanSteps)
      : Infinity;
    if (dtMs <= 0 || dtMs > maxAllowed) continue;

    out[i] = ((ahs[i1] - ahs[i0]) / dtMs) * 60_000;
  }
  return out;
}

/** Y values for a metric across a point list (handles derived ahRate). */
function metricSeries(
  points: TrialSeries["points"],
  key: MetricKey,
  maxGapMs = Infinity,
): number[] {
  if (key === "ahRate") return ahRateSeries(points, maxGapMs);
  return points.map((p) => metricValue(p, key));
}

function splitContinuousPointRuns(
  points: TrialSeries["points"],
  maxGapMs: number,
): TrialSeries["points"][] {
  if (points.length === 0) return [];

  const runs: TrialSeries["points"][] = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const prevMs = Date.parse(points[i - 1].time);
    const nextMs = Date.parse(points[i].time);
    if (
      Number.isFinite(prevMs) &&
      Number.isFinite(nextMs) &&
      nextMs - prevMs > maxGapMs
    ) {
      runs.push(points.slice(start, i));
      start = i;
    }
  }
  runs.push(points.slice(start));
  return runs;
}

function buildRawTraceSeries(
  points: TrialSeries["points"],
  metric: MetricKey,
  mode: PlotMode,
  startIso: string | null,
  color: string,
  label: string,
  plotLabel: string,
  bookmarks: TrialBookmark[],
  breakOnGaps: boolean,
  yValues: number[],
): {
  x: (string | number)[];
  y: Array<number | null>;
  text: string[];
  customdata: string[];
} {
  const runs = breakOnGaps
    ? splitContinuousPointRuns(points, FULL_RES_GAP_MS)
    : [points];
  const x: (string | number)[] = [];
  const y: Array<number | null> = [];
  const text: string[] = [];
  const customdata: string[] = [];

  let cursor = 0;
  runs.forEach((run, runIdx) => {
    if (runIdx > 0) {
      x.push(mode === "aligned" ? Number.NaN : run[0].time);
      y.push(null);
      text.push("");
      customdata.push("");
    }

    for (let j = 0; j < run.length; j++) {
      const p = run[j];
      const yValue = yValues[cursor + j];
      const xValue =
        mode === "aligned"
          ? startIso
            ? (Date.parse(p.time) - Date.parse(startIso)) / 60000
            : null
          : p.time;
      if (
        xValue === null ||
        (typeof xValue === "number" && !Number.isFinite(xValue))
      ) {
        continue;
      }

      const nearby = nearbyBookmarkForSample(points[0]?.time, bookmarks, p.time);
      const yPlot = Number.isFinite(yValue) ? yValue : null;
      x.push(xValue);
      y.push(yPlot);
      customdata.push(formatClockUtc(new Date(p.time)));
      text.push(
        [
          `<span style="color:${color}">●</span> ${label}`,
          ...(plotLabel.trim() ? [plotLabel.trim()] : []),
          yPlot === null
            ? `${METRIC_SHORT[metric].short} —`
            : `${METRIC_SHORT[metric].short} ${yPlot.toFixed(3)} ${METRIC_SHORT[metric].unit}`,
          ...(nearby ? [`${nearby.time} - ${nearby.note}`] : []),
        ].join("<br>"),
      );
    }
    cursor += run.length;
  });

  return { x, y, text, customdata };
}

/** Legend / hover label: channel · filename · optional plot label. */
function legendName(s: TrialSeries): string {
  const dup = s.meta.label;
  const short = s.meta.filename.replace(/\.csv$/i, "");
  const plotLabel = s.meta.plotLabel?.trim();
  return plotLabel
    ? `${dup} · ${short} · ${plotLabel}`
    : `${dup} · ${short}`;
}

/**
 * Resolve a bookmark clock time onto the plot x-axis.
 * Calendar mode → ISO timestamp; aligned mode → minutes since session start.
 */
function bookmarkX(
  firstSampleIso: string | undefined,
  bookmarkTime: string,
  mode: PlotMode,
  sessionStart: string | null,
): string | number | null {
  const iso = sessionStartIso(firstSampleIso, bookmarkTime);
  if (!iso) return null;
  if (mode === "calendar") return iso;
  if (!sessionStart) return null;
  return (Date.parse(iso) - Date.parse(sessionStart)) / 60000;
}

function nearbyBookmarkForSample(
  firstSampleIso: string | undefined,
  bookmarks: TrialBookmark[],
  sampleIso: string,
): { time: string; note: string } | null {
  if (!firstSampleIso || bookmarks.length === 0) return null;
  const sampleMs = Date.parse(sampleIso);
  if (!Number.isFinite(sampleMs)) return null;

  const thresholdMs = 2500;
  let best: { bm: TrialBookmark; diffMs: number } | null = null;
  for (const bm of bookmarks) {
    const bmIso = sessionStartIso(firstSampleIso, bm.time);
    if (!bmIso) continue;
    const bmMs = Date.parse(bmIso);
    if (!Number.isFinite(bmMs)) continue;
    const diffMs = Math.abs(bmMs - sampleMs);
    if (!best || diffMs < best.diffMs) best = { bm, diffMs };
  }
  if (!best || best.diffMs > thresholdMs) return null;
  return { time: best.bm.time, note: best.bm.note };
}

function metricValueAtInstant(
  points: TrialSeries["points"],
  targetIso: string,
  metric: MetricKey,
): number | null {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs) || points.length === 0) return null;

  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < points.length; i++) {
    const diff = Math.abs(Date.parse(points[i].time) - targetMs);
    if (diff < bestDiff) {
      bestIdx = i;
      bestDiff = diff;
    }
  }
  const ys = metricSeries(points, metric, FULL_RES_GAP_MS);
  const v = ys[bestIdx];
  return Number.isFinite(v) ? v : null;
}

function metricValueAtBookmark(
  points: TrialSeries["points"],
  bookmark: TrialBookmark,
  metric: MetricKey,
): number | null {
  const targetIso =
    bookmark.plotIso ?? sessionStartIso(points[0]?.time, bookmark.time);
  if (!targetIso) return null;
  return metricValueAtInstant(points, targetIso, metric);
}

/** Format a Date as HH:MM:SS in UTC (matches CSV / bookmark clock). */
function formatClockUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Convert a Plotly x value into HH:MM:SS for the bookmark form.
 * Calendar: x is ISO/Date. Aligned: x is minutes since session start.
 * Always UTC clock digits so pasted time matches hover customdata / CSV.
 */
function xToClockTime(
  x: string | number | Date,
  mode: PlotMode,
  sessionStartIsoStr: string | null,
): string | null {
  if (mode === "aligned") {
    if (!sessionStartIsoStr) return null;
    const mins = typeof x === "number" ? x : Number(x);
    if (!Number.isFinite(mins)) return null;
    return formatClockUtc(
      new Date(Date.parse(sessionStartIsoStr) + mins * 60_000),
    );
  }

  let ms: number;
  if (x instanceof Date) ms = x.getTime();
  else if (typeof x === "number") ms = x;
  else ms = Date.parse(String(x));
  if (!Number.isFinite(ms)) return null;
  return formatClockUtc(new Date(ms));
}

type AxisPixels = LayoutAxis & {
  _offset?: number;
  p2d?: (pixel: number) => number | string | Date;
};

/** Map a Plotly datum to pixel coords inside the plot div. */
function datumToPixels(pt: PlotDatum): { x: number; y: number } | null {
  const xa = pt.xaxis as AxisPixels;
  const ya = pt.yaxis as AxisPixels;
  if (typeof xa?.l2p !== "function" || typeof ya?.l2p !== "function") return null;
  try {
    const x = (xa._offset ?? 0) + xa.l2p(pt.x as Datum);
    const y = (ya._offset ?? 0) + ya.l2p(pt.y as Datum);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * X at the cursor / hover spike — same time the unified hover label uses.
 * Do NOT use the nearest curve's sample x (that can be a different second).
 */
function spikeXFromEvent(
  points: PlotDatum[],
  event: MouseEvent,
): string | number | Date | null {
  const pt0 = points[0];
  if (!pt0) return null;

  const xa = pt0.xaxis as AxisPixels;
  const plotEl = (event.target as HTMLElement | null)?.closest?.(
    ".js-plotly-plot",
  ) as HTMLElement | null;
  const rect = plotEl?.getBoundingClientRect();
  if (rect && typeof xa.p2d === "function") {
    try {
      const mx = event.clientX - rect.left - (xa._offset ?? 0);
      const x = xa.p2d(mx);
      if (x !== undefined && x !== null && x !== "") return x as string | number | Date;
    } catch {
      /* fall through */
    }
  }
  // Fallback: first point in the unified-x event (hover spike).
  return pt0.x as string | number | Date;
}

/**
 * With hovermode "x unified", a click returns EVERY trial at that time.
 * Pick the curve nearest the cursor in Y (time comes from spikeX separately).
 */
function pickNearestTrialPoint(
  points: PlotDatum[],
  event: MouseEvent,
  curveMeta: CurveMeta[],
): PlotDatum | null {
  if (!points.length) return null;

  const plotEl = (event.target as HTMLElement | null)?.closest?.(
    ".js-plotly-plot",
  ) as HTMLElement | null;
  const rect = plotEl?.getBoundingClientRect();
  const my = event.clientY - (rect?.top ?? 0);

  const preferred = points.filter((p) => {
    const m = curveMeta[p.curveNumber];
    return m && (m.kind === "raw" || m.kind === "bookmark") && m.trialId;
  });
  const pool = preferred.length > 0 ? preferred : points;

  let best: PlotDatum | null = null;
  let bestDist = Infinity;
  for (const pt of pool) {
    const pix = datumToPixels(pt);
    if (!pix) continue;
    const dist = Math.abs(pix.y - my);
    if (dist < bestDist) {
      bestDist = dist;
      best = pt;
    }
  }

  return best ?? pool[0] ?? null;
}

function paddedRange(vals: number[]): [number, number] {
  if (vals.length === 0) return [0, 1];
  let lo = vals[0];
  let hi = vals[0];
  for (const v of vals) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.06 || 0.1;
  return [lo - pad, hi + pad];
}

export function SensorPlot({
  series,
  mode,
  metrics = ["absHumidity", "rh", "temp"],
  height = 720,
  plotRevision = 0,
  showSmooth = true,
  showBookmarks = true,
  fullResolution = false,
  onTimePick,
}: Props) {
  // Lazy-load Plotly only when we have data (keeps initial bundle smaller).
  const [PlotComponent, setPlotComponent] = useState<ComponentType<{
    data: Data[];
    layout: Partial<Layout>;
    config: Record<string, unknown>;
    style: Record<string, string | number>;
    useResizeHandler?: boolean;
    revision?: number;
    onInitialized?: (figure: unknown, graphDiv: HTMLElement) => void;
    onUpdate?: (figure: unknown, graphDiv: HTMLElement) => void;
    onClick?: (e: Readonly<PlotMouseEvent>) => void;
  }> | null>(null);

  const curveMetaRef = useRef<CurveMeta[]>([]);
  const graphDivRef = useRef<HTMLElement | null>(null);
  const lowessCacheRef = useRef(
    new Map<string, { x: number[]; y: number[] }>(),
  );
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const suppressClicksUntilRef = useRef(0);

  const pointsKey = useMemo(() => pointsFingerprint(series), [series]);
  const bookmarksKey = useMemo(() => bookmarksFingerprint(series), [series]);
  const plotLabelsKey = useMemo(() => plotLabelFingerprint(series), [series]);

  useEffect(() => {
    let cancelled = false;
    if (series.length === 0) {
      setPlotComponent(null);
      return () => {
        cancelled = true;
      };
    }
    void import("react-plotly.js").then((mod) => {
      if (!cancelled) setPlotComponent(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [series.length]);

  // Drop LOWESS cache when the underlying samples change.
  useEffect(() => {
    lowessCacheRef.current.clear();
    suppressClicksUntilRef.current = Date.now() + 400;
  }, [pointsKey, mode, showSmooth, fullResolution]);

  useEffect(() => {
    suppressClicksUntilRef.current = Date.now() + 200;
  }, [bookmarksKey, plotRevision]);

  const colors = useMemo(
    () => trialColorMapById(series.map((s) => ({ id: s.meta.id, label: s.meta.label }))),
    [series],
  );

  const sessionByTrial = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const s of series) {
      map.set(
        s.meta.id,
        sessionStartIso(s.points[0]?.time, s.meta.sessionStartTime),
      );
    }
    return map;
  }, [series]);

  /**
   * Expensive layer: raw + LOWESS traces and y-axis ranges.
   * Intentionally ignores bookmark hover / bookmark list edits.
   */
  const base = useMemo(() => {
    const current = seriesRef.current;
    const traces: Data[] = [];
    const meta: CurveMeta[] = [];
    const shapes: Partial<Shape>[] = [];
    const n = metrics.length;
    const metricValues: number[][] = metrics.map(() => []);

    current.forEach((s) => {
      const color = colors[s.meta.id] ?? "#888";
      const group = s.meta.id;
      const name = legendName(s);
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );

      // Cap points before smoothing / hover unless full resolution is on.
      const keep = plotPointIndices(
        s.points.length,
        fullResolution,
        PLOT_MAX_POINTS,
      );
      const pts = keep.map((i) => s.points[i]);
      const fullResRuns = fullResolution
        ? splitContinuousPointRuns(pts, FULL_RES_GAP_MS)
        : [pts];
      const rateGapMs = fullResolution ? FULL_RES_GAP_MS : Infinity;

      metrics.forEach((metric, mi) => {
        const axisY = mi === 0 ? "y" : (`y${mi + 1}` as const);
        const ys = metricSeries(pts, metric, rateGapMs);
        for (const v of ys) {
          if (Number.isFinite(v)) metricValues[mi].push(v);
        }
        if (mode === "aligned" && !startIso) return;

        const rawTrace = buildRawTraceSeries(
          pts,
          metric,
          mode,
          startIso,
          color,
          name,
          s.meta.plotLabel ?? "",
          s.meta.bookmarks ?? [],
          fullResolution,
          ys,
        );

        traces.push({
          type: "scatter",
          mode: "lines",
          name,
          legendgroup: group,
          showlegend: mi === 0,
          x: rawTrace.x,
          y: rawTrace.y,
          customdata: rawTrace.customdata,
          text: rawTrace.text,
          yaxis: axisY,
          line: { color, width: showSmooth ? 1 : 2 },
          opacity: showSmooth ? 0.35 : 0.9,
          connectgaps: false,
          hovertemplate: "%{text}<extra></extra>",
        });
        meta.push({
          trialId: s.meta.id,
          kind: "raw",
          color,
          metric,
        });

        if (showSmooth) {
          fullResRuns.forEach((run, runIdx) => {
            if (run.length < 2) return;

            const allRunYs = metricSeries(run, metric, rateGapMs);
            const pairs = run
              .map((p, i) => ({ p, y: allRunYs[i] }))
              .filter((row) => Number.isFinite(row.y));
            if (pairs.length < 2) return;

            const xNum =
              mode === "aligned"
                ? pairs.map(
                    (row) =>
                      (Date.parse(row.p.time) - Date.parse(startIso!)) / 60000,
                  )
                : pairs.map((row) => Date.parse(row.p.time));
            const yNum = pairs.map((row) => row.y);
            const cacheKey = `${s.meta.id}|${metric}|${mode}|${runIdx}|${xNum.length}|${xNum[0]}|${xNum[xNum.length - 1]}`;
            let smooth = lowessCacheRef.current.get(cacheKey);
            if (!smooth) {
              smooth = lowess(xNum, yNum, LOWESS_SPAN);
              lowessCacheRef.current.set(cacheKey, smooth);
            }
            const smoothX =
              mode === "aligned"
                ? smooth.x
                : smooth.x.map((t) => new Date(t).toISOString());

            traces.push({
              type: "scatter",
              mode: "lines",
              name: `${name} (smooth)`,
              legendgroup: group,
              showlegend: false,
              x: smoothX,
              y: smooth.y,
              yaxis: axisY,
              line: { color, width: 2.4 },
              hoverinfo: "skip",
            });
          });
          meta.push({ trialId: s.meta.id, kind: "smooth", color, metric });
        }

        if (mode === "calendar" && startIso && mi === 0) {
          shapes.push({
            type: "line",
            xref: "x",
            yref: "paper",
            x0: startIso,
            x1: startIso,
            y0: 0,
            y1: 1,
            line: { color, width: 1.5, dash: "dash" },
          });
        }
      });
    });

    if (mode === "aligned") {
      shapes.push({
        type: "line",
        xref: "x",
        yref: "paper",
        x0: 0,
        x1: 0,
        y0: 0,
        y1: 1,
        line: { color: DARK_THEME.subtext, width: 1, dash: "dot" },
      });
    }

    const domainH = 1 / n;
    const gap = 0.06;
    const yAxes: Record<string, Partial<LayoutAxis>> = {};
    metrics.forEach((metric, mi) => {
      const top = 1 - mi * domainH;
      const bottom = 1 - (mi + 1) * domainH + gap;
      const key = mi === 0 ? "yaxis" : `yaxis${mi + 1}`;
      yAxes[key] = {
        title: {
          text: METRIC_LABELS[metric],
          font: { size: 11, color: DARK_THEME.text },
        },
        domain: [Math.max(0, bottom), top - 0.02],
        gridcolor: DARK_THEME.gridMajor,
        zeroline: metric === "ahRate",
        zerolinecolor: DARK_THEME.subtext,
        tickfont: { color: DARK_THEME.subtext, size: 10 },
        automargin: true,
        autorange: false,
        range: paddedRange(metricValues[mi]),
      };
    });

    return { traces, meta, shapes, yAxes, n };
    // pointsKey stands in for series samples; colors keyed by trial ids in pointsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey, mode, metrics, colors, showSmooth, fullResolution]);

  /** Cheap layer: bookmark markers + guide lines only. */
  const bookmarkLayer = useMemo(() => {
    const current = seriesRef.current;
    const traces: Data[] = [];
    const meta: CurveMeta[] = [];
    const shapes: Partial<Shape>[] = [];
    if (!showBookmarks) return { traces, meta, shapes };

    // Shared auto end lines: one hover + one shape per run (not per ch1/ch2/amb X trial).
    const sharedEnds = new Map<
      string,
      { bookmark: TrialBookmark; x: string | number }
    >();
    for (const s of current) {
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );
      for (const b of plotBookmarksForSeries(s)) {
        if (!isComputedEndBookmark(b)) continue;
        const x = bookmarkPlotX(b, s.points[0]?.time, mode, startIso);
        if (x === null || sharedEnds.has(b.id)) continue;
        sharedEnds.set(b.id, { bookmark: b, x });
      }
    }

    if (sharedEnds.size > 0) {
      let yLo = Infinity;
      let yHi = -Infinity;
      for (const s of current) {
        const vals = metricSeries(
          s.points,
          metrics[0],
          fullResolution ? FULL_RES_GAP_MS : Infinity,
        );
        for (const v of vals) {
          if (!Number.isFinite(v)) continue;
          if (v < yLo) yLo = v;
          if (v > yHi) yHi = v;
        }
      }
      if (Number.isFinite(yLo) && Number.isFinite(yHi)) {
        const pad = (yHi - yLo) * 0.08 || Math.abs(yHi) * 0.08 || 0.5;
        yLo -= pad;
        yHi += pad;

        for (const { bookmark: b, x } of sharedEnds.values()) {
          const hoverText = `${b.note}<br>${b.time}`;
          const hx: (string | number)[] = [];
          const hy: number[] = [];
          const ht: string[] = [];
          for (let i = 0; i < END_LINE_HOVER_STEPS; i++) {
            const t = i / (END_LINE_HOVER_STEPS - 1);
            hx.push(x);
            hy.push(yLo + t * (yHi - yLo));
            ht.push(hoverText);
          }

          traces.push({
            type: "scatter",
            mode: "lines",
            name: b.note,
            showlegend: false,
            x: hx,
            y: hy,
            yaxis: "y",
            line: { color: END_LINE_COLOR, width: 1.5, dash: "dot" },
            hovertemplate: "%{text}<extra></extra>",
            text: ht,
          });
          meta.push({
            trialId: "",
            kind: "bookmark",
            color: END_LINE_COLOR,
            metric: metrics[0],
          });

          shapes.push({
            type: "line",
            xref: "x",
            yref: "paper",
            x0: x,
            x1: x,
            y0: 0,
            y1: 1,
            line: { color: END_LINE_COLOR, width: 1, dash: "dot" },
            opacity: 0.7,
          });
        }
      }
    }

    current.forEach((s) => {
      const color = colors[s.meta.id] ?? "#888";
      const name = legendName(s);
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );
      const bookmarks = plotBookmarksForSeries(s).filter(
        (b) => !isComputedEndBookmark(b),
      );
      if (!bookmarks.length) return;

      const bx: (string | number)[] = [];
      const by: number[] = [];
      const texts: string[] = [];

      for (const b of bookmarks) {
        const x = bookmarkPlotX(b, s.points[0]?.time, mode, startIso);
        if (x === null) continue;

        const y = metricValueAtBookmark(s.points, b, metrics[0]);
        if (y === null) continue;
        bx.push(x);
        by.push(y);
        texts.push(
          `<span style="color:${color}">◆</span> ${s.meta.label}<br>${isComputedStartBookmark(b) ? "Start" : "Bookmark"} ${b.time}<br>${b.note}`,
        );
        shapes.push({
          type: "line",
          xref: "x",
          yref: "paper",
          x0: x,
          x1: x,
          y0: 0,
          y1: 1,
          line: { color, width: 1, dash: "dot" },
          opacity: 0.55,
        });
      }
      if (!bx.length) return;

      traces.push({
        type: "scatter",
        mode: "markers",
        name: `${name} bookmarks`,
        legendgroup: s.meta.id,
        showlegend: false,
        x: bx,
        y: by,
        yaxis: "y",
        cliponaxis: false,
        marker: {
          symbol: "diamond",
          size: BOOKMARK_SIZE,
          color,
          line: { width: 1.5, color: "#ffffff" },
        },
        text: texts,
        hovertemplate: "%{text}<extra></extra>",
      });
      meta.push({
        trialId: s.meta.id,
        kind: "bookmark",
        color,
        bookmarkCount: bx.length,
        metric: metrics[0],
      });
    });

    return { traces, meta, shapes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarksKey, showBookmarks, mode, metrics, colors, pointsKey]);

  const layout = useMemo(() => {
    const current = seriesRef.current;

    const dateLabels = uniqueDateLabels(current.map((s) => s.meta));
    const datePart =
      dateLabels.length === 0
        ? null
        : dateLabels.length === 1
          ? dateLabels[0]
          : dateLabels.join("   |   ");

    const titleBase =
      mode === "aligned"
        ? metrics.length === 1
          ? `${METRIC_LABELS[metrics[0]]} vs Elapsed Time (aligned by session start)`
          : "Absolute Humidity, Relative Humidity & Temperature vs Elapsed Time (aligned by session start)"
        : metrics.length === 1
          ? `${METRIC_LABELS[metrics[0]]} vs Time`
          : "Absolute Humidity, Relative Humidity & Temperature vs Time";

    const layoutObj: Partial<Layout> = {
      title: {
        text: datePart ? `${titleBase} — ${datePart}` : titleBase,
        font: { color: "#ffffff", size: 15 },
        x: 0.01,
        xanchor: "left",
      },
      annotations: [],
      paper_bgcolor: DARK_THEME.bg,
      plot_bgcolor: DARK_THEME.bg,
      font: { color: DARK_THEME.text },
      showlegend: true,
      legend: {
        title: { text: "Trial" },
        bgcolor: DARK_THEME.bg,
        font: { color: DARK_THEME.text },
      },
      margin: { t: 56, r: 24, b: 56, l: 72 },
      hovermode: "x unified",
      hoverdistance: 20,
      uirevision: "sensor-plot",
      shapes: [...base.shapes, ...bookmarkLayer.shapes],
      xaxis: {
        title: {
          text:
            mode === "aligned"
              ? "Elapsed Time Since Session Start (minutes)"
              : "Time",
          font: { color: DARK_THEME.text, size: 11 },
        },
        gridcolor: DARK_THEME.gridMajor,
        tickfont: { color: DARK_THEME.subtext, size: 10 },
        showspikes: true,
        spikemode: "across",
        spikethickness: 1,
        spikedash: "dot",
        spikecolor: DARK_THEME.subtext,
        anchor: (base.n > 1 ? `y${base.n}` : "y") as LayoutAxis["anchor"],
        ...(mode === "calendar"
          ? { type: "date" as const, tickformat: "%H:%M" }
          : {}),
      },
      ...base.yAxes,
      height,
    };
    return layoutObj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, bookmarkLayer, mode, metrics, height, plotLabelsKey, pointsKey]);

  const data = useMemo(
    () => [...base.traces, ...bookmarkLayer.traces],
    [base.traces, bookmarkLayer.traces],
  );

  // curveNumber order = base traces then bookmark traces
  curveMetaRef.current = [...base.meta, ...bookmarkLayer.meta];

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    if (!onTimePick) return;
    if (Date.now() < suppressClicksUntilRef.current) return;
    const points = e.points ?? [];
    if (!points.length) return;

    const pt = pickNearestTrialPoint(points, e.event, curveMetaRef.current);
    if (!pt) return;

    const m = curveMetaRef.current[pt.curveNumber];
    if (!m || !m.trialId) return;

    let time: string | null = null;
    if (
      typeof pt.customdata === "string" &&
      /^\d{2}:\d{2}:\d{2}$/.test(pt.customdata)
    ) {
      time = pt.customdata;
    } else {
      const spikeX = spikeXFromEvent(points, e.event);
      if (spikeX === null) return;
      const startIso = sessionByTrial.get(m.trialId) ?? null;
      time = xToClockTime(spikeX, mode, startIso);
    }
    if (!time) return;
    onTimePick({ trialId: m.trialId, time });
  };

  if (series.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
        Select one or more trials to plot.
      </div>
    );
  }

  if (!PlotComponent) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
        Loading plot…
      </div>
    );
  }

  // Remount only when the set of trials / view mode changes — not on bookmark edits.
  const mountKey = `${series.map((s) => s.meta.id).join(",")}|${mode}|${metrics.join("-")}|${showSmooth}|${fullResolution}`;

  return (
    <div className="overflow-hidden rounded-lg border border-[#3a3b3f] bg-[#1e1f22]">
      <PlotComponent
        key={mountKey}
        data={data}
        layout={layout}
        revision={plotRevision}
        config={{
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ["lasso2d", "select2d"],
          toImageButtonOptions: {
            format: "png",
            filename: "chamber_sensor_plot",
            scale: 2,
          },
        }}
        style={{ width: "100%", height }}
        useResizeHandler
        onInitialized={(_fig, gd) => {
          graphDivRef.current = gd;
        }}
        onUpdate={(_fig, gd) => {
          graphDivRef.current = gd;
        }}
        onClick={handleClick}
      />
    </div>
  );
}
