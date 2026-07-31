"use client";

/**
 * =============================================================================
 * COMPUTATION / PLOT MODULE: EvapRateVsVpdPlot.tsx
 * Scatter: x = VPD [kPa], y = AH_rate [g/m³/min]; OLS trendlines
 * =============================================================================
 *
 * DATA MATH IS NOT IN THIS FILE'S EQUATIONS — it calls derived-metrics.ts.
 * This file is responsible for:
 *   1. Choosing which SensorPoints to feed the math (downsample / full res)
 *   2. Calling detectAhTurnaround → ahRateSeries → vpdSeries
 *   3. Keeping pairs where VPD and AH_rate are finite and VPD > 0
 *   4. Optional pooling by chamber × Light/Dark plotLabel
 *   5. OLS linear fit y = m x + b per cloud
 *   6. Axis display ranges (X padded to data; Y = 2–98th percentile)
 *
 * STEP-BY-STEP PER TRIAL (collectPostTurnaroundPoints)
 * ----------------------------------------------------
 *   sessionStartMs ← sessionStartIso(firstSample, meta.sessionStartTime)
 *   trough         ← detectAhTurnaround(FULL s.points, sessionStartMs)
 *                    // argmin LOESS(AH) in 0–40 min after session start
 *   pts            ← downsample(s.points) unless fullResolution
 *   AH_rate[]      ← ahRateSeries(pts, …)  // Δ LOESS(AH)/Δt; no sign filter
 *   VPD[]          ← vpdSeries(pts, { smooth: true })  // LOESS(VPD)
 *   keep i if finite(VPD_i), finite(AH_rate_i), VPD_i > 0
 *   point = (VPD_i, AH_rate_i)
 *
 * POOL MODE: merge those points across CSVs sharing (ch1|ch2) × (light|dark).
 * =============================================================================
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { Data, Layout, LayoutAxis } from "plotly.js";
import { DARK_THEME, trialColorMapById } from "@/lib/colors";
import {
  ahRateSeries,
  detectAhTurnaround,
  percentileRange,
  vpdSeries,
} from "@/lib/derived-metrics";
import { PLOT_MAX_POINTS, plotPointIndices } from "@/lib/downsample";
import { sessionStartIso } from "@/lib/parse-csv";
import { uniqueDateLabels } from "@/lib/trial-sort";
import type { TrialSeries } from "@/types/trial";

type Props = {
  series: TrialSeries[];
  height?: number;
  plotRevision?: number;
  fullResolution?: boolean;
  /**
   * Merge selected trials by chamber (ch1/ch2) + Light/Dark plotLabel into
   * pooled clouds (one color + fit each), instead of one series per CSV.
   */
  poolLightDark?: boolean;
};

type LightCondition = "light" | "dark";

type ScatterPoint = {
  vpd: number;
  rate: number;
  text: string;
};

const CONDITION_COLORS: Record<LightCondition, string> = {
  light: "#E0A04A",
  dark: "#5B8DEF",
};

function legendName(s: TrialSeries): string {
  const short = s.meta.filename.replace(/\.csv$/i, "");
  const plotLabel = s.meta.plotLabel?.trim();
  return plotLabel
    ? `${s.meta.label} · ${short} · ${plotLabel}`
    : `${s.meta.label} · ${short}`;
}

/** Map plot labels like "Dark" / "Light, 45°" → light | dark. */
export function lightConditionFromPlotLabel(
  plotLabel: string | null | undefined,
): LightCondition | null {
  const s = (plotLabel ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "dark" || s.startsWith("dark")) return "dark";
  if (s.startsWith("light")) return "light";
  return null;
}

function formatClockUtc(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Ordinary least-squares line through scatter cloud: y = m x + b.
 *
 * EQUATIONS (n finite pairs)
 * --------------------------
 *   m = (n Σxy − Σx Σy) / (n Σx² − (Σx)²)
 *   b = (Σy − m Σx) / n
 * Line segment drawn from x_min to x_max of the cloud:
 *   (x_min, m x_min + b) → (x_max, m x_max + b)
 *
 * Requires n ≥ 2 and non-degenerate x span. This is the "· fit" legend entry.
 */
function linearFit(
  xs: number[],
  ys: number[],
): { x0: number; x1: number; y0: number; y1: number } | null {
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let xMin = Infinity;
  let xMax = -Infinity;

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n += 1;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }

  if (n < 2 || !(xMax > xMin)) return null;
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-18) return null;

  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return {
    x0: xMin,
    x1: xMax,
    y0: m * xMin + b,
    y1: m * xMax + b,
  };
}

function paddedAxisRange(vals: number[]): [number, number] {
  if (vals.length === 0) return [0, 1];
  let lo = vals[0];
  let hi = vals[0];
  for (const v of vals) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.06 || 0.01;
  return [lo - pad, hi + pad];
}

/**
 * Build post-turnaround (VPD, AH_rate) points for one trial CSV.
 *
 * AUDIT CHECKLIST
 * ---------------
 * [ ] Trough from FULL series s.points (not downsampled) — correct t_start
 * [ ] Rates/VPD from pts (may be downsampled) but masked with same troughMs
 * [ ] ahRateSeries: Δ LOESS(AH)/Δt_min (derived-metrics.ts)
 * [ ] vpdSeries({ smooth: true }): LOESS(VPD)
 * [ ] No minAhRate — negatives kept
 * [ ] Drop only: non-finite VPD/rate, or VPD ≤ 0
 *
 * CALL CHAIN
 * ----------
 * sessionStartIso (parse-csv) → detectAhTurnaround (derived-metrics)
 *   → ahRateSeries + vpdSeries (derived-metrics) → scatter pairs here
 */
function collectPostTurnaroundPoints(
  s: TrialSeries,
  fullResolution: boolean,
  color: string,
): ScatterPoint[] {
  const name = legendName(s);
  const keep = plotPointIndices(
    s.points.length,
    fullResolution,
    PLOT_MAX_POINTS,
  );
  const pts = keep.map((i) => s.points[i]);
  const startIso = sessionStartIso(
    s.points[0]?.time,
    s.meta.sessionStartTime,
  );
  const sessionStartMs = startIso ? Date.parse(startIso) : null;
  const originMs = Number.isFinite(sessionStartMs) ? sessionStartMs : null;
  const trough = detectAhTurnaround(s.points, originMs);
  const rateOpts = {
    sessionStartMs: originMs,
    readyAfterMs: trough?.troughMs ?? null,
    /** LOESS(VPD) so scatter x matches Fit-quality smoothing. */
    smooth: true,
  };
  const rates = ahRateSeries(
    pts,
    fullResolution ? 10_000 : Infinity,
    rateOpts,
  );
  const vpds = vpdSeries(pts, rateOpts);

  const out: ScatterPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const vpd = vpds[i];
    const rate = rates[i];
    if (!Number.isFinite(vpd) || !Number.isFinite(rate) || vpd <= 0) continue;
    out.push({
      vpd,
      rate,
      text: [
        `<span style="color:${color}">●</span> ${name}`,
        `VPD ${vpd.toFixed(4)} kPa`,
        `dAH/dt ${rate.toFixed(4)} g/m³/min`,
        formatClockUtc(pts[i].time),
      ].join("<br>"),
    });
  }
  return out;
}

function pushScatterAndFit(
  tracesOut: Data[],
  name: string,
  group: string,
  color: string,
  points: ScatterPoint[],
  allX: number[],
  allY: number[],
) {
  if (points.length === 0) return;
  const x = points.map((p) => p.vpd);
  const y = points.map((p) => p.rate);
  const text = points.map((p) => p.text);
  for (const p of points) {
    allX.push(p.vpd);
    allY.push(p.rate);
  }

  tracesOut.push({
    type: "scatter",
    mode: "markers",
    name,
    legendgroup: group,
    showlegend: true,
    x,
    y,
    text,
    hovertemplate: "%{text}<extra></extra>",
    marker: { size: 4, color, opacity: 0.4 },
  });

  const fit = linearFit(x, y);
  if (fit) {
    tracesOut.push({
      type: "scatter",
      mode: "lines",
      name: `${name} · fit`,
      legendgroup: group,
      showlegend: true,
      x: [fit.x0, fit.x1],
      y: [fit.y0, fit.y1],
      line: { color, width: 2.6 },
      hoverinfo: "skip",
    });
  }
}

export function EvapRateVsVpdPlot({
  series,
  height = 520,
  plotRevision = 0,
  fullResolution = false,
  poolLightDark = false,
}: Props) {
  const [PlotComponent, setPlotComponent] = useState<ComponentType<{
    data: Data[];
    layout: Partial<Layout>;
    config: Record<string, unknown>;
    style: Record<string, string | number>;
    useResizeHandler?: boolean;
    revision?: number;
  }> | null>(null);

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

  const colors = useMemo(
    () =>
      trialColorMapById(
        series.map((s) => ({ id: s.meta.id, label: s.meta.label })),
      ),
    [series],
  );

  const { traces, xVals, yVals, skippedUnlabeled } = useMemo(() => {
    const tracesOut: Data[] = [];
    const allX: number[] = [];
    const allY: number[] = [];
    let skippedUnlabeled = 0;

    if (!poolLightDark) {
      for (const s of series) {
        const color = colors[s.meta.id] ?? "#888";
        const pts = collectPostTurnaroundPoints(s, fullResolution, color);
        pushScatterAndFit(
          tracesOut,
          legendName(s),
          s.meta.id,
          color,
          pts,
          allX,
          allY,
        );
      }
      return { traces: tracesOut, xVals: allX, yVals: allY, skippedUnlabeled: 0 };
    }

    // chamber (ch1/ch2) → condition → pooled points + trial count
    type Bucket = { points: ScatterPoint[]; trialCount: number };
    const byChamber = new Map<
      string,
      { light?: Bucket; dark?: Bucket }
    >();

    for (const s of series) {
      const condition = lightConditionFromPlotLabel(s.meta.plotLabel);
      if (!condition) {
        skippedUnlabeled += 1;
        continue;
      }
      const chamber = s.meta.label?.trim() || "unknown";
      const color = CONDITION_COLORS[condition];
      const pts = collectPostTurnaroundPoints(s, fullResolution, color);
      if (pts.length === 0) continue;

      let row = byChamber.get(chamber);
      if (!row) {
        row = {};
        byChamber.set(chamber, row);
      }
      const existing = row[condition];
      if (!existing) {
        row[condition] = { points: [...pts], trialCount: 1 };
      } else {
        existing.points.push(...pts);
        existing.trialCount += 1;
      }
    }

    const chambers = [...byChamber.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    for (const chamber of chambers) {
      const row = byChamber.get(chamber)!;
      for (const condition of ["light", "dark"] as const) {
        const bucket = row[condition];
        if (!bucket?.points.length) continue;
        const label =
          condition === "light" ? "Light (on)" : "Dark (off)";
        const name = `${chamber} · ${label} · ${bucket.trialCount} trial${bucket.trialCount === 1 ? "" : "s"}`;
        pushScatterAndFit(
          tracesOut,
          name,
          `${chamber}|${condition}`,
          CONDITION_COLORS[condition],
          bucket.points,
          allX,
          allY,
        );
      }
    }

    return { traces: tracesOut, xVals: allX, yVals: allY, skippedUnlabeled };
  }, [series, colors, fullResolution, poolLightDark]);

  const layout = useMemo((): Partial<Layout> => {
    const dateLabels = uniqueDateLabels(series.map((s) => s.meta));
    const datePart =
      dateLabels.length === 0
        ? null
        : dateLabels.length === 1
          ? dateLabels[0]
          : dateLabels.join("   |   ");
    const titleBase = poolLightDark
      ? "Evaporation Rate vs VPD — pooled Light vs Dark by chamber"
      : "Evaporation Rate vs Vapor Pressure Deficit";
    const yAxis: Partial<LayoutAxis> = {
      title: {
        text: "AH Rate dAH/dt (g/m³/min)",
        font: { size: 11, color: DARK_THEME.text },
      },
      gridcolor: DARK_THEME.gridMajor,
      zeroline: true,
      zerolinecolor: DARK_THEME.subtext,
      tickfont: { color: DARK_THEME.subtext, size: 10 },
      automargin: true,
      autorange: false,
      range: percentileRange(yVals, 2, 98),
    };

    return {
      title: {
        text: datePart ? `${titleBase} — ${datePart}` : titleBase,
        font: { color: "#ffffff", size: 15 },
        x: 0.01,
        xanchor: "left",
      },
      paper_bgcolor: DARK_THEME.bg,
      plot_bgcolor: DARK_THEME.bg,
      font: { color: DARK_THEME.text },
      showlegend: true,
      legend: {
        title: { text: poolLightDark ? "Condition" : "Trial" },
        bgcolor: DARK_THEME.bg,
        font: { color: DARK_THEME.text },
      },
      margin: { t: 56, r: 24, b: 56, l: 72 },
      hovermode: "closest",
      uirevision: poolLightDark ? "evap-vs-vpd-pool" : "evap-vs-vpd",
      xaxis: {
        title: {
          text: "Vapor Pressure Deficit (kPa)",
          font: { color: DARK_THEME.text, size: 11 },
        },
        gridcolor: DARK_THEME.gridMajor,
        zeroline: true,
        zerolinecolor: DARK_THEME.subtext,
        tickfont: { color: DARK_THEME.subtext, size: 10 },
        autorange: false,
        range: paddedAxisRange(xVals),
      },
      yaxis: yAxis,
      height,
    };
  }, [series, xVals, yVals, height, poolLightDark]);

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

  const mountKey = `${series.map((s) => s.meta.id).join(",")}|ahRateVsVpd|${fullResolution}|${poolLightDark ? "pool" : "trial"}`;

  return (
    <div className="space-y-2">
      {poolLightDark && skippedUnlabeled > 0 ? (
        <p className="text-xs text-[#8a8a8d]">
          Skipped {skippedUnlabeled} selected trial
          {skippedUnlabeled === 1 ? "" : "s"} without a Light/Dark plot label.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-[#3a3b3f] bg-[#1e1f22]">
        <PlotComponent
          key={mountKey}
          data={traces}
          layout={layout}
          revision={plotRevision}
          config={{
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
            toImageButtonOptions: {
              format: "png",
              filename: poolLightDark
                ? "evaporation_rate_vs_vpd_pooled"
                : "evaporation_rate_vs_vpd",
              scale: 2,
            },
          }}
          style={{ width: "100%", height }}
          useResizeHandler
        />
      </div>
    </div>
  );
}
