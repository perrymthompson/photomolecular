"use client";

/**
 * Evaporation Rate vs VPD — scatter / line of AH_rate (y) against VPD (x).
 * Points follow chronological order within each trial (line connects time).
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { Data, Layout, LayoutAxis } from "plotly.js";
import { DARK_THEME, trialColorMapById } from "@/lib/colors";
import { ahRateSeries, vpdSeries } from "@/lib/derived-metrics";
import { PLOT_MAX_POINTS, plotPointIndices } from "@/lib/downsample";
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

function formatClockUtc(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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
      const rates = ahRateSeries(pts, fullResolution ? 10_000 : Infinity);
      const vpds = vpdSeries(pts);

      const x: number[] = [];
      const y: Array<number | null> = [];
      const text: string[] = [];
      let needGap = false;

      for (let i = 0; i < pts.length; i++) {
        const vpd = vpds[i];
        const rate = rates[i];
        if (!Number.isFinite(vpd) || !Number.isFinite(rate)) {
          needGap = x.length > 0;
          continue;
        }
        if (needGap) {
          x.push(vpd);
          y.push(null);
          text.push("");
          needGap = false;
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
        mode: "lines+markers",
        name,
        legendgroup: s.meta.id,
        x,
        y,
        text,
        hovertemplate: "%{text}<extra></extra>",
        connectgaps: false,
        marker: { size: 5, color, opacity: 0.75 },
        line: { color, width: 1.4 },
      });
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
      range: paddedRange(yVals),
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
        range: paddedRange(xVals),
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
