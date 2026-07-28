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
 *   Hover the diamond markers to read the note text.
 * =============================================================================
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { Data, Layout, LayoutAxis, Shape } from "plotly.js";
import { DARK_THEME, trialColorMapById } from "@/lib/colors";
import { LOWESS_SPAN, lowess } from "@/lib/lowess";
import { sessionStartIso } from "@/lib/parse-csv";
import { uniqueDateLabels } from "@/lib/trial-sort";
import type { MetricKey, PlotMode, TrialSeries } from "@/types/trial";
import { METRIC_LABELS } from "@/types/trial";

type Props = {
  series: TrialSeries[];
  mode: PlotMode;
  /** Which y-panels to show. Combined view passes all three. */
  metrics?: MetricKey[];
  height?: number;
  /** Bumped by parent to force Plotly remount after view/mode changes. */
  plotRevision?: number;
};

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

export function SensorPlot({
  series,
  mode,
  metrics = ["absHumidity", "rh", "temp"],
  height = 720,
  plotRevision = 0,
}: Props) {
  // Lazy-load Plotly only when we have data (keeps initial bundle smaller).
  const [PlotComponent, setPlotComponent] = useState<ComponentType<{
    data: Data[];
    layout: Partial<Layout>;
    config: Record<string, unknown>;
    style: Record<string, string | number>;
    useResizeHandler?: boolean;
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

  // One distinct color per trial id (not per "ch1" label — labels can collide).
  const colors = useMemo(
    () => trialColorMapById(series.map((s) => ({ id: s.meta.id, label: s.meta.label }))),
    [series],
  );

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    const shapes: Partial<Shape>[] = [];
    const n = metrics.length;

    series.forEach((s) => {
      const color = colors[s.meta.id] ?? "#888";
      const group = s.meta.id;
      const name = legendName(s);

      // Session start = first sample's calendar date + meta.sessionStartTime.
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );

      // ---- Sensor metric traces (raw faint + LOWESS thick) ----------------
      metrics.forEach((metric, mi) => {
        // Stacked panels: first metric uses "y", then "y2", "y3", …
        const axisY = mi === 0 ? "y" : (`y${mi + 1}` as const);
        const xsCal = s.points.map((p) => p.time);
        const ys = s.points.map((p) => metricValue(p, metric));

        // X values: ISO strings (clock) OR minutes since session start (aligned).
        let xs: (string | number)[] = xsCal;
        if (mode === "aligned") {
          if (!startIso) return; // cannot align without session start
          const t0 = Date.parse(startIso);
          xs = s.points.map((p) => (Date.parse(p.time) - t0) / 60000);
        }

        // Raw data — thin, semi-transparent (matches R aesthetic).
        traces.push({
          type: "scatter",
          mode: "lines",
          name,
          legendgroup: group,
          showlegend: mi === 0,
          x: xs,
          y: ys,
          yaxis: axisY,
          line: { color, width: 1 },
          opacity: 0.35,
          hovertemplate:
            mode === "aligned"
              ? `%{x:.1f} min<br>${METRIC_LABELS[metric]}: %{y:.3f}<extra>${name}</extra>`
              : `%{x|%H:%M:%S}<br>${METRIC_LABELS[metric]}: %{y:.3f}<extra>${name}</extra>`,
        });

        // LOWESS smooth — span 0.08 of points (same idea as R loess span).
        // lowess() needs numeric x; for calendar mode we pass epoch ms.
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
          name: `${name} (smooth)`,
          legendgroup: group,
          showlegend: false,
          x: smoothX,
          y: smooth.y,
          yaxis: axisY,
          line: { color, width: 2.4 },
          hoverinfo: "skip", // hover shows raw points only
        });

        // Dashed vertical line at session start (clock mode, once per trial).
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

      // ---- Time bookmarks (hoverable markers + light vertical lines) ------
      const bookmarks = s.meta.bookmarks ?? [];
      if (bookmarks.length > 0) {
        const bx: (string | number)[] = [];
        const texts: string[] = [];

        for (const b of bookmarks) {
          const x = bookmarkX(s.points[0]?.time, b.time, mode, startIso);
          if (x === null) continue;
          bx.push(x);
          texts.push(`${b.time} — ${b.note}`);

          // Soft vertical guide at the bookmark time.
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

        if (bx.length > 0) {
          // Diamond markers on the top panel so hover works with unified x hover.
          // y= mid of first metric range is unknown without scanning — use
          // "markers" with y from first metric midpoint approx: use NaN-safe
          // approach — place at the mean of the first metric for visibility.
          const firstYs = s.points.map((p) => metricValue(p, metrics[0]));
          const midY =
            firstYs.length > 0
              ? firstYs.reduce((a, v) => a + v, 0) / firstYs.length
              : 0;

          traces.push({
            type: "scatter",
            mode: "markers",
            name: `${name} bookmarks`,
            legendgroup: group,
            showlegend: false,
            x: bx,
            y: bx.map(() => midY),
            yaxis: "y",
            marker: {
              symbol: "diamond",
              size: 11,
              color,
              line: { width: 1, color: "#ffffff" },
            },
            text: texts,
            hovertemplate: `%{text}<extra>${name}</extra>`,
          });
        }
      }
    });

    // Aligned mode: dotted line at x=0 (session start for every trial).
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

    // Stacked y-axis domains (Combined view = 3 panels with small gaps).
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

    // Trial-level notes (not bookmarks) shown as a subtitle annotation.
    const notes = series
      .filter((s) => s.meta.notes?.trim())
      .map((s) => `${legendName(s)}: ${s.meta.notes.trim()}`)
      .join("   |   ");

    const dateLabels = uniqueDateLabels(series.map((s) => s.meta));
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

  if (!PlotComponent) {
    return (
      <div className="flex h-80 items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
        Loading plot…
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#3a3b3f] bg-[#1e1f22]">
      <PlotComponent
        key={`plot-${plotRevision}-${mode}-${metrics.join("-")}-${series.map((s) => s.meta.id).join(",")}`}
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
