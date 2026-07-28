"use client";

/**
 * =============================================================================
 * SensorPlot — chamber sensor plotting (AH / RH / Temp)
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
 *
 * X-AXIS MODES:
 *   - calendar ("Clock time"):  ISO timestamps; Plotly date axis, tick %H:%M
 *   - aligned  ("Align…"):      minutes since sessionStartTime; requires that
 *                               field on every trial; AH-only when parent
 *                               forces metrics=["absHumidity"]
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
import { LOWESS_SPAN, lowess } from "@/lib/lowess";
import { sessionStartIso } from "@/lib/parse-csv";
import { uniqueDateLabels } from "@/lib/trial-sort";
import type { MetricKey, PlotMode, TrialSeries } from "@/types/trial";
import { METRIC_LABELS } from "@/types/trial";

export type PlotTimePick = {
  trialId: string;
  /** Clock time HH:MM:SS for the bookmark form. */
  time: string;
};

type Props = {
  series: TrialSeries[];
  mode: PlotMode;
  /** Which y-panels to show. Combined view passes all three. */
  metrics?: MetricKey[];
  height?: number;
  /** Bumped by parent to force Plotly remount after view/mode changes. */
  plotRevision?: number;
  /** Draw LOWESS smooth curves (default true). */
  showSmooth?: boolean;
  /** Draw bookmark diamonds + guide lines (default true). */
  showBookmarks?: boolean;
  /** Click a point/time → fill bookmark form (does not create a bookmark). */
  onTimePick?: (pick: PlotTimePick) => void;
};

type CurveMeta = {
  trialId: string;
  kind: "raw" | "smooth" | "bookmark";
  color: string;
  bookmarkCount?: number;
};

const BOOKMARK_SIZE = 11;
const BOOKMARK_HOVER_SIZE = 18;

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
      const bms = s.meta.bookmarks ?? [];
      return `${s.meta.id}:${bms.map((b) => `${b.id}:${b.time}:${b.note}`).join(",")}`;
    })
    .join("|");
}

function notesFingerprint(series: TrialSeries[]): string {
  return series.map((s) => `${s.meta.id}:${s.meta.notes ?? ""}`).join("|");
}

/** Pick the numeric y-value for a metric from one sample point. */
function metricValue(p: TrialSeries["points"][0], key: MetricKey): number {
  if (key === "absHumidity") return p.absHumidity;
  if (key === "rh") return p.rh;
  return p.temp;
}

/** Legend / hover label: channel · filename (unique when multiple ch1s exist). */
function legendName(s: TrialSeries): string {
  const dup = s.meta.label;
  const short = s.meta.filename.replace(/\.csv$/i, "");
  return `${dup} · ${short}`;
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

function getPlotlyApi(
  mod: typeof import("plotly.js/dist/plotly"),
): {
  restyle: (
    graphDiv: unknown,
    update: Record<string, unknown>,
    traces?: number | number[],
  ) => Promise<unknown>;
} {
  return mod.default ?? mod;
}

export function SensorPlot({
  series,
  mode,
  metrics = ["absHumidity", "rh", "temp"],
  height = 720,
  plotRevision = 0,
  showSmooth = true,
  showBookmarks = true,
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
    onHover?: (e: Readonly<PlotMouseEvent>) => void;
    onUnhover?: (e: Readonly<PlotMouseEvent>) => void;
  }> | null>(null);

  const curveMetaRef = useRef<CurveMeta[]>([]);
  const graphDivRef = useRef<HTMLElement | null>(null);
  const hoverBmRef = useRef<{
    curveNumber: number;
    count: number;
    pointIndex: number;
  } | null>(null);
  const lowessCacheRef = useRef(
    new Map<string, { x: number[]; y: number[] }>(),
  );
  const seriesRef = useRef(series);
  seriesRef.current = series;

  const pointsKey = useMemo(() => pointsFingerprint(series), [series]);
  const bookmarksKey = useMemo(() => bookmarksFingerprint(series), [series]);
  const notesKey = useMemo(() => notesFingerprint(series), [series]);

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
    hoverBmRef.current = null;
  }, [pointsKey, mode, showSmooth]);

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

      metrics.forEach((metric, mi) => {
        const axisY = mi === 0 ? "y" : (`y${mi + 1}` as const);
        const xsCal = s.points.map((p) => p.time);
        const ys = s.points.map((p) => metricValue(p, metric));
        metricValues[mi].push(...ys);

        let xs: (string | number)[] = xsCal;
        if (mode === "aligned") {
          if (!startIso) return;
          const t0 = Date.parse(startIso);
          xs = s.points.map((p) => (Date.parse(p.time) - t0) / 60000);
        }

        const clockLabels = s.points.map((p) =>
          formatClockUtc(new Date(p.time)),
        );

        traces.push({
          type: "scatter",
          mode: "lines",
          name,
          legendgroup: group,
          showlegend: mi === 0,
          x: xs,
          y: ys,
          customdata: clockLabels,
          yaxis: axisY,
          line: { color, width: showSmooth ? 1 : 2 },
          opacity: showSmooth ? 0.35 : 0.9,
          hovertemplate:
            mode === "aligned"
              ? `%{x:.1f} min<br>${METRIC_LABELS[metric]}: %{y:.3f}<extra>${name}</extra>`
              : `%{customdata}<br>${METRIC_LABELS[metric]}: %{y:.3f}<extra>${name}</extra>`,
        });
        meta.push({ trialId: s.meta.id, kind: "raw", color });

        if (showSmooth) {
          const xNum =
            mode === "aligned"
              ? (xs as number[])
              : xsCal.map((t) => Date.parse(t));
          const cacheKey = `${s.meta.id}|${metric}|${mode}|${xNum.length}|${xNum[0]}|${xNum[xNum.length - 1]}`;
          let smooth = lowessCacheRef.current.get(cacheKey);
          if (!smooth) {
            smooth = lowess(xNum, ys, LOWESS_SPAN);
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
          meta.push({ trialId: s.meta.id, kind: "smooth", color });
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
        zeroline: false,
        tickfont: { color: DARK_THEME.subtext, size: 10 },
        automargin: true,
        autorange: false,
        range: paddedRange(metricValues[mi]),
      };
    });

    return { traces, meta, shapes, yAxes, n };
    // pointsKey stands in for series samples; colors keyed by trial ids in pointsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey, mode, metrics, colors, showSmooth]);

  /** Cheap layer: bookmark markers + guide lines only. */
  const bookmarkLayer = useMemo(() => {
    const current = seriesRef.current;
    const traces: Data[] = [];
    const meta: CurveMeta[] = [];
    const shapes: Partial<Shape>[] = [];
    if (!showBookmarks) return { traces, meta, shapes };

    current.forEach((s) => {
      const color = colors[s.meta.id] ?? "#888";
      const name = legendName(s);
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );
      const bookmarks = s.meta.bookmarks ?? [];
      if (!bookmarks.length) return;

      const bx: (string | number)[] = [];
      const texts: string[] = [];
      for (const b of bookmarks) {
        const x = bookmarkX(s.points[0]?.time, b.time, mode, startIso);
        if (x === null) continue;
        bx.push(x);
        texts.push(`${b.time} — ${b.note}`);
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

      const firstYs = s.points.map((p) => metricValue(p, metrics[0]));
      const midY =
        firstYs.length > 0
          ? firstYs.reduce((a, v) => a + v, 0) / firstYs.length
          : 0;

      traces.push({
        type: "scatter",
        mode: "markers",
        name: `${name} bookmarks`,
        legendgroup: s.meta.id,
        showlegend: false,
        x: bx,
        y: bx.map(() => midY),
        yaxis: "y",
        cliponaxis: false,
        marker: {
          symbol: "diamond",
          size: BOOKMARK_SIZE,
          color,
          line: { width: 1.5, color: "#ffffff" },
        },
        text: texts,
        hovertemplate: `%{text}<extra>${name}</extra>`,
      });
      meta.push({
        trialId: s.meta.id,
        kind: "bookmark",
        color,
        bookmarkCount: bx.length,
      });
    });

    return { traces, meta, shapes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarksKey, showBookmarks, mode, metrics, colors, pointsKey]);

  const layout = useMemo(() => {
    const current = seriesRef.current;
    const notes = current
      .filter((s) => s.meta.notes?.trim())
      .map((s) => `${legendName(s)}: ${s.meta.notes.trim()}`)
      .join("   |   ");

    const dateLabels = uniqueDateLabels(current.map((s) => s.meta));
    const datePart =
      dateLabels.length === 0
        ? null
        : dateLabels.length === 1
          ? dateLabels[0]
          : dateLabels.join("   |   ");

    const titleBase =
      mode === "aligned"
        ? "Absolute Humidity vs Elapsed Time (aligned by session start)"
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
      annotations: notes
        ? [
            {
              text: notes,
              xref: "paper",
              yref: "paper",
              x: 0,
              y: 1.06,
              showarrow: false,
              font: { color: DARK_THEME.subtext, size: 11 },
              xanchor: "left",
            },
          ]
        : [],
      paper_bgcolor: DARK_THEME.bg,
      plot_bgcolor: DARK_THEME.bg,
      font: { color: DARK_THEME.text },
      showlegend: true,
      legend: {
        title: { text: "Trial" },
        bgcolor: DARK_THEME.bg,
        font: { color: DARK_THEME.text },
      },
      margin: { t: notes ? 72 : 56, r: 24, b: 56, l: 72 },
      hovermode: "x unified",
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
  }, [base, bookmarkLayer, mode, metrics, height, notesKey, pointsKey]);

  const data = useMemo(
    () => [...base.traces, ...bookmarkLayer.traces],
    [base.traces, bookmarkLayer.traces],
  );

  // curveNumber order = base traces then bookmark traces
  curveMetaRef.current = [...base.meta, ...bookmarkLayer.meta];

  const resetBookmarkHover = () => {
    const prev = hoverBmRef.current;
    const gd = graphDivRef.current;
    if (!prev || !gd) return;
    hoverBmRef.current = null;
    const sizes = Array.from({ length: prev.count }, () => BOOKMARK_SIZE);
    void import("plotly.js/dist/plotly").then((mod) => {
      void getPlotlyApi(mod).restyle(
        gd,
        { "marker.size": [sizes] },
        [prev.curveNumber],
      );
    });
  };

  const handleHover = (e: Readonly<PlotMouseEvent>) => {
    const points = e.points ?? [];
    const bmPt = points.find(
      (p) => curveMetaRef.current[p.curveNumber]?.kind === "bookmark",
    );
    if (!bmPt) {
      resetBookmarkHover();
      return;
    }

    const m = curveMetaRef.current[bmPt.curveNumber]!;
    const count = m.bookmarkCount ?? 1;
    const idx =
      typeof bmPt.pointIndex === "number"
        ? bmPt.pointIndex
        : typeof bmPt.pointNumber === "number"
          ? bmPt.pointNumber
          : 0;

    const prev = hoverBmRef.current;
    if (
      prev &&
      prev.curveNumber === bmPt.curveNumber &&
      prev.pointIndex === idx
    ) {
      return; // already enlarged — skip restyle thrash while moving on the diamond
    }

    const sizes = Array.from({ length: count }, () => BOOKMARK_SIZE);
    if (idx >= 0 && idx < count) sizes[idx] = BOOKMARK_HOVER_SIZE;

    const gd = graphDivRef.current;
    if (!gd) return;

    void import("plotly.js/dist/plotly").then((mod) => {
      const Plotly = getPlotlyApi(mod);
      if (prev && prev.curveNumber !== bmPt.curveNumber) {
        void Plotly.restyle(
          gd,
          {
            "marker.size": [
              Array.from({ length: prev.count }, () => BOOKMARK_SIZE),
            ],
          },
          [prev.curveNumber],
        );
      }
      hoverBmRef.current = {
        curveNumber: bmPt.curveNumber,
        count,
        pointIndex: idx,
      };
      void Plotly.restyle(gd, { "marker.size": [sizes] }, [bmPt.curveNumber]);
    });
  };

  const handleUnhover = () => {
    resetBookmarkHover();
  };

  const handleClick = (e: Readonly<PlotMouseEvent>) => {
    if (!onTimePick) return;
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
  const mountKey = `${series.map((s) => s.meta.id).join(",")}|${mode}|${metrics.join("-")}|${showSmooth}`;

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
        onHover={handleHover}
        onUnhover={handleUnhover}
      />
    </div>
  );
}
