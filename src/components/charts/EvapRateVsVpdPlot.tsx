"use client";

/**
 * Evaporation Rate vs VPD — scatter of AH_rate (y) against VPD (x).
 * Markers only (no time-connecting lines); per-trial linear trendlines.
 * X/Y axes auto-scale from the plotted data (robust percentiles on Y).
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { Data, Layout, LayoutAxis } from "plotly.js";
import { DARK_THEME, trialColorMapById } from "@/lib/colors";
import {
  AH_RATE_MIN_FOR_EVAP_PLOTS,
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
};

function legendName(s: TrialSeries): string {
  const short = s.meta.filename.replace(/\.csv$/i, "");
  const plotLabel = s.meta.plotLabel?.trim();
  return plotLabel
    ? `${s.meta.label} · ${short} · ${plotLabel}`
    : `${s.meta.label} · ${short}`;
}

function formatClockUtc(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Ordinary least-squares line y = m x + b over finite (x, y) pairs. */
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

export function EvapRateVsVpdPlot({
  series,
  height = 520,
  plotRevision = 0,
  fullResolution = false,
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

  const { traces, xVals, yVals } = useMemo(() => {
    const tracesOut: Data[] = [];
    const allX: number[] = [];
    const allY: number[] = [];

    for (const s of series) {
      const color = colors[s.meta.id] ?? "#888";
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
        minAhRate: AH_RATE_MIN_FOR_EVAP_PLOTS,
      };
      const rates = ahRateSeries(
        pts,
        fullResolution ? 10_000 : Infinity,
        rateOpts,
      );
      const vpds = vpdSeries(pts, rateOpts);

      const x: number[] = [];
      const y: number[] = [];
      const text: string[] = [];

      for (let i = 0; i < pts.length; i++) {
        const vpd = vpds[i];
        const rate = rates[i];
        if (!Number.isFinite(vpd) || !Number.isFinite(rate) || vpd <= 0) {
          continue;
        }
        x.push(vpd);
        y.push(rate);
        allX.push(vpd);
        allY.push(rate);
        text.push(
          [
            `<span style="color:${color}">●</span> ${name}`,
            `VPD ${vpd.toFixed(4)} kPa`,
            `dAH/dt ${rate.toFixed(4)} g/m³/min`,
            formatClockUtc(pts[i].time),
          ].join("<br>"),
        );
      }

      if (x.length === 0) continue;

      tracesOut.push({
        type: "scatter",
        mode: "markers",
        name,
        legendgroup: s.meta.id,
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
          legendgroup: s.meta.id,
          showlegend: true,
          x: [fit.x0, fit.x1],
          y: [fit.y0, fit.y1],
          line: { color, width: 2.6 },
          hoverinfo: "skip",
        });
      }
    }

    return { traces: tracesOut, xVals: allX, yVals: allY };
  }, [series, colors, fullResolution]);

  const layout = useMemo((): Partial<Layout> => {
    const dateLabels = uniqueDateLabels(series.map((s) => s.meta));
    const datePart =
      dateLabels.length === 0
        ? null
        : dateLabels.length === 1
          ? dateLabels[0]
          : dateLabels.join("   |   ");
    const titleBase = "Evaporation Rate vs Vapor Pressure Deficit";
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
        title: { text: "Trial" },
        bgcolor: DARK_THEME.bg,
        font: { color: DARK_THEME.text },
      },
      margin: { t: 56, r: 24, b: 56, l: 72 },
      hovermode: "closest",
      uirevision: "evap-vs-vpd",
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
  }, [series, xVals, yVals, height]);

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

  const mountKey = `${series.map((s) => s.meta.id).join(",")}|ahRateVsVpd|${fullResolution}`;

  return (
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
            filename: "evaporation_rate_vs_vpd",
            scale: 2,
          },
        }}
        style={{ width: "100%", height }}
        useResizeHandler
      />
    </div>
  );
}
