"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { Data, Layout, LayoutAxis, Shape } from "plotly.js";
import { DARK_THEME, trialColorMap } from "@/lib/colors";
import { LOWESS_SPAN, lowess } from "@/lib/lowess";
import { sessionStartIso } from "@/lib/parse-csv";
import type { MetricKey, PlotMode, TrialSeries } from "@/types/trial";
import { METRIC_LABELS } from "@/types/trial";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Props = {
  series: TrialSeries[];
  mode: PlotMode;
  /** Which metrics to show as stacked facets (default: all three). */
  metrics?: MetricKey[];
  height?: number;
};

function metricValue(p: TrialSeries["points"][0], key: MetricKey): number {
  if (key === "absHumidity") return p.absHumidity;
  if (key === "rh") return p.rh;
  return p.temp;
}

export function SensorPlot({
  series,
  mode,
  metrics = ["absHumidity", "rh", "temp"],
  height = 720,
}: Props) {
  const colors = useMemo(
    () => trialColorMap(series.map((s) => s.meta.label)),
    [series],
  );

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    const shapes: Partial<Shape>[] = [];
    const n = metrics.length;

    series.forEach((s) => {
      const color = colors[s.meta.label] ?? "#888";
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );

      metrics.forEach((metric, mi) => {
        const axisY = mi === 0 ? "y" : (`y${mi + 1}` as const);
        const xsCal = s.points.map((p) => p.time);
        const ys = s.points.map((p) => metricValue(p, metric));

        let xs: (string | number)[] = xsCal;
        if (mode === "aligned") {
          if (!startIso) return;
          const t0 = Date.parse(startIso);
          xs = s.points.map((p) => (Date.parse(p.time) - t0) / 60000);
        }

        traces.push({
          type: "scatter",
          mode: "lines",
          name: s.meta.label,
          legendgroup: s.meta.label,
          showlegend: mi === 0,
          x: xs,
          y: ys,
          yaxis: axisY,
          line: { color, width: 1 },
          opacity: 0.35,
          hovertemplate:
            mode === "aligned"
              ? `%{x:.1f} min<br>${METRIC_LABELS[metric]}: %{y:.3f}<extra>${s.meta.label}</extra>`
              : `%{x|%H:%M:%S}<br>${METRIC_LABELS[metric]}: %{y:.3f}<extra>${s.meta.label}</extra>`,
        });

        const xNum =
          mode === "aligned"
            ? (xs as number[])
            : xsCal.map((t) => Date.parse(t));
        const smooth = lowess(xNum, ys, LOWESS_SPAN);
        const smoothX =
          mode === "aligned"
            ? smooth.x
            : smooth.x.map((t) => new Date(t).toISOString());

        traces.push({
          type: "scatter",
          mode: "lines",
          name: `${s.meta.label} (smooth)`,
          legendgroup: s.meta.label,
          showlegend: false,
          x: smoothX,
          y: smooth.y,
          yaxis: axisY,
          line: { color, width: 2.4 },
          hoverinfo: "skip",
        });

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
      };
    });

    const notes = series
      .filter((s) => s.meta.notes?.trim())
      .map((s) => `${s.meta.label}: ${s.meta.notes.trim()}`)
      .join("   |   ");

    const dates = [
      ...new Set(series.map((s) => s.meta.dateLabel).filter(Boolean)),
    ] as string[];
    const datePart =
      dates.length === 1
        ? dates[0]
        : dates.length > 1
          ? series
              .filter((s) => s.meta.dateLabel)
              .map((s) => `${s.meta.label}: ${s.meta.dateLabel}`)
              .join("   |   ")
          : null;

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
      shapes,
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
        anchor: (n > 1 ? `y${n}` : "y") as LayoutAxis["anchor"],
        ...(mode === "calendar"
          ? { type: "date" as const, tickformat: "%H:%M" }
          : {}),
      },
      ...yAxes,
      height,
    };

    return { data: traces, layout: layoutObj };
  }, [series, mode, metrics, colors, height]);

  if (series.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
        Select one or more trials to plot.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#3a3b3f] bg-[#1e1f22]">
      <Plot
        data={data}
        layout={layout}
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
      />
    </div>
  );
}
