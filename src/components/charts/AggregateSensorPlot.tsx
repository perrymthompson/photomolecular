"use client";

/**
 * AggregateSensorPlot — pooled multi-trial comparison (Set A vs Set B).
 *
 * Fit off  → scatter of all pooled points per set
 * Fit on   → LOESS best-fit curves on each pooled cloud (+ faint scatter)
 * Diff / Cum Δ → Set A fit − Set B fit on shared x (same stats as individual plots)
 */

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { Data, Layout, LayoutAxis } from "plotly.js";
import { plotThemeFor } from "@/lib/colors";
import { useTheme } from "@/components/theme/ThemeProvider";
import {
  commonOverlapRange,
  fitPooledSeries,
  poolNumericXY,
  scatterSubsample,
  type AggregateFitKind,
} from "@/lib/aggregate-series";
import {
  diffSeriesStats,
  formatPValue,
  formatSigned,
  type DiffSeriesStats,
} from "@/lib/diff-stats";
import {
  cumulativeSum,
  differenceOnSharedX,
  integralDifferenceOnSharedX,
  type NumericSeries,
} from "@/lib/series-diff";
import type { MetricKey, PlotMode, TrialSeries } from "@/types/trial";
import { isElapsedPlotMode, METRIC_LABELS } from "@/types/trial";

type Props = {
  seriesA: TrialSeries[];
  seriesB: TrialSeries[];
  labelA?: string;
  labelB?: string;
  mode: PlotMode;
  metrics?: MetricKey[];
  height?: number;
  plotRevision?: number;
  /** Fit on = draw fit curves; Fit off = scatter only. */
  showSmooth?: boolean;
  /** LOESS or exponential (y = a e^(bx)). */
  fitKind?: AggregateFitKind;
  fullResolution?: boolean;
  showDifference?: boolean;
  showCumulativeDifference?: boolean;
};

type DiffStatRow = {
  metric: MetricKey;
  label: string;
  unit: string;
  stats: DiffSeriesStats;
  integralDelta: number | null;
  integralUnit: string;
  meanFromIntegral: number | null;
  overlapMinutes: number | null;
};

const SET_A_COLOR = "#4C8FD1";
const SET_B_COLOR = "#E2574C";
const DIFF_LINE_COLOR = "#E8C547";
const CUM_DIFF_LINE_COLOR = "#6EC6A8";

const METRIC_SHORT: Record<MetricKey, { short: string; unit: string }> = {
  absHumidity: { short: "AH", unit: "g/m³" },
  rh: { short: "RH", unit: "%RH" },
  temp: { short: "Temp", unit: "°C" },
  ahRate: { short: "dAH/dt", unit: "g/m³/min" },
  vpd: { short: "VPD", unit: "kPa" },
  normRate: { short: "Norm Rate", unit: "(g/m³/min)/kPa" },
};

function integralUnitFor(metric: MetricKey): string {
  if (metric === "normRate") return "(g/m³)/kPa";
  if (metric === "ahRate") return "g/m³";
  return `${METRIC_SHORT[metric].unit}·min`;
}

function formatClockUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function paddedRange(vals: number[]): [number, number] {
  const finite = vals.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [-1, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.05 || 0.1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

function axisId(panel: number): string {
  return panel === 0 ? "y" : `y${panel + 1}`;
}

function toPlotX(x: number[], mode: PlotMode): (string | number)[] {
  if (isElapsedPlotMode(mode)) return x;
  return x.map((t) => new Date(t).toISOString());
}

function pointsFingerprint(series: TrialSeries[]): string {
  return series
    .map((s) => {
      const first = s.points[0]?.time ?? "";
      const last = s.points[s.points.length - 1]?.time ?? "";
      return `${s.meta.id}:${s.points.length}:${first}:${last}:${s.meta.sessionStartTime ?? ""}`;
    })
    .join("|");
}

export function AggregateSensorPlot({
  seriesA,
  seriesB,
  labelA = "Set A",
  labelB = "Set B",
  mode,
  metrics = ["absHumidity"],
  height = 520,
  plotRevision = 0,
  showSmooth = true,
  fitKind = "loess",
  fullResolution = true,
  showDifference = false,
  showCumulativeDifference = false,
}: Props) {
  const { mode: colorMode } = useTheme();
  const plotTheme = useMemo(() => plotThemeFor(colorMode), [colorMode]);
  const [PlotComponent, setPlotComponent] = useState<ComponentType<{
    data: Data[];
    layout: Partial<Layout>;
    revision?: number;
    config?: object;
    style?: object;
    useResizeHandler?: boolean;
  }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("react-plotly.js").then((mod) => {
      if (!cancelled) setPlotComponent(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pointsKey = useMemo(
    () =>
      `A:${pointsFingerprint(seriesA)}|B:${pointsFingerprint(seriesB)}`,
    [seriesA, seriesB],
  );

  const base = useMemo(() => {
    const nMetric = metrics.length;
    const wantDiff = showDifference;
    const wantCum = showCumulativeDifference;
    const n = nMetric + (wantCum ? nMetric : 0);
    const traces: Data[] = [];
    const shapes: Partial<import("plotly.js").Shape>[] = [];
    const metricValues: number[][] = Array.from({ length: n }, () => []);
    const diffStats: DiffStatRow[] = [];

    metrics.forEach((metric, mi) => {
      // Restrict pooling / fit to x where every selected trial (A ∪ B) has data.
      const overlapTrials = [...seriesA, ...seriesB];
      const overlap = commonOverlapRange(
        overlapTrials,
        metric,
        mode,
        fullResolution,
      );
      if (!overlap) return;

      const pooledA = poolNumericXY(
        seriesA,
        metric,
        mode,
        fullResolution,
        labelA,
        overlap,
      );
      const pooledB = poolNumericXY(
        seriesB,
        metric,
        mode,
        fullResolution,
        labelB,
        overlap,
      );

      const fitSuffix = fitKind === "exp" ? "exp" : "LOESS";

      const addScatter = (pooled: NumericSeries, color: string, name: string) => {
        const sc = scatterSubsample(pooled);
        for (const v of sc.y) {
          if (Number.isFinite(v)) metricValues[mi].push(v);
        }
        const xPlot = toPlotX(sc.x, mode);
        const short = METRIC_SHORT[metric].short;
        const unit = METRIC_SHORT[metric].unit;
        const text = sc.y.map((v, i) => {
          const xv = sc.x[i];
          return (
            `<span style="color:${color}">●</span> ${name}<br>` +
            `${short} ${v.toFixed(4)} ${unit}` +
            (isElapsedPlotMode(mode)
              ? `<br>Elapsed ${xv.toFixed(2)} min`
              : `<br>${formatClockUtc(new Date(xv))}`)
          );
        });
        traces.push({
          type: "scatter",
          mode: "markers",
          name: showSmooth ? `${name} · points` : name,
          legendgroup: name,
          showlegend: true,
          x: xPlot,
          y: sc.y,
          text,
          yaxis: axisId(mi),
          marker: {
            color,
            size: 4,
            opacity: showSmooth ? 0.22 : 0.55,
          },
          hovertemplate: "%{text}<extra></extra>",
        });
      };

      const addFit = (fit: NumericSeries, color: string, name: string) => {
        for (const v of fit.y) {
          if (Number.isFinite(v)) metricValues[mi].push(v);
        }
        const xPlot = toPlotX(fit.x, mode);
        const short = METRIC_SHORT[metric].short;
        const unit = METRIC_SHORT[metric].unit;
        const text = fit.y.map((v, i) => {
          const xv = fit.x[i];
          return (
            `<span style="color:${color}">●</span> ${name} · ${fitSuffix}<br>` +
            `${short} ${v.toFixed(4)} ${unit}` +
            (isElapsedPlotMode(mode)
              ? `<br>Elapsed ${xv.toFixed(2)} min`
              : `<br>${formatClockUtc(new Date(xv))}`)
          );
        });
        traces.push({
          type: "scatter",
          mode: "lines",
          name: `${name} · ${fitSuffix}`,
          legendgroup: name,
          showlegend: true,
          x: xPlot,
          y: fit.y,
          text,
          yaxis: axisId(mi),
          line: { color, width: 2.8 },
          connectgaps: false,
          hovertemplate: "%{text}<extra></extra>",
        });
      };

      let fitA: NumericSeries | null = null;
      let fitB: NumericSeries | null = null;

      if (pooledA) {
        addScatter(pooledA, SET_A_COLOR, labelA);
        fitA = fitPooledSeries(pooledA, fitKind);
        if (showSmooth && fitA) addFit(fitA, SET_A_COLOR, labelA);
      }
      if (pooledB) {
        addScatter(pooledB, SET_B_COLOR, labelB);
        fitB = fitPooledSeries(pooledB, fitKind);
        if (showSmooth && fitB) addFit(fitB, SET_B_COLOR, labelB);
      }

      if (wantDiff || wantCum) {
        // Diff uses LOESS fits of each pool (fallback: subsampled cloud).
        const a: NumericSeries | null =
          fitA ?? (pooledA ? scatterSubsample(pooledA) : null);
        const b: NumericSeries | null =
          fitB ?? (pooledB ? scatterSubsample(pooledB) : null);
        if (!a || !b) return;

        const diff = differenceOnSharedX(a, b);
        if (!diff) return;

        const stats = diffSeriesStats(diff.y);
        const integral = integralDifferenceOnSharedX(
          a,
          b,
          mode === "calendar",
        );
        if (stats) {
          diffStats.push({
            metric,
            label: METRIC_SHORT[metric].short,
            unit: METRIC_SHORT[metric].unit,
            stats,
            integralDelta: integral?.integralDelta ?? null,
            integralUnit: integralUnitFor(metric),
            meanFromIntegral: integral?.meanFromIntegral ?? null,
            overlapMinutes: integral?.overlapMinutes ?? null,
          });
        }

        const xPlot = toPlotX(diff.x, mode);
        const unit = METRIC_SHORT[metric].unit;
        const short = METRIC_SHORT[metric].short;

        if (wantDiff) {
          for (const v of diff.y) {
            if (Number.isFinite(v)) metricValues[mi].push(v);
          }
          const text = diff.y.map(
            (v, i) =>
              `<span style="color:${DIFF_LINE_COLOR}">●</span> ${diff.name}<br>` +
              `${short} Δ ${v.toFixed(4)} ${unit}` +
              (isElapsedPlotMode(mode)
                ? `<br>Elapsed ${diff.x[i].toFixed(2)} min`
                : `<br>${formatClockUtc(new Date(diff.x[i]))}`),
          );
          traces.push({
            type: "scatter",
            mode: "lines",
            name: diff.name,
            legendgroup: "difference",
            showlegend: mi === 0,
            x: xPlot,
            y: diff.y,
            text,
            yaxis: axisId(mi),
            line: { color: DIFF_LINE_COLOR, width: 2.6 },
            connectgaps: false,
            hovertemplate: "%{text}<extra></extra>",
          });
        }

        if (wantCum) {
          const cumY = cumulativeSum(diff.y);
          const cumPanel = nMetric + mi;
          for (const v of cumY) {
            if (Number.isFinite(v)) metricValues[cumPanel].push(v);
          }
          const cumName = `Cumulative Δ (${a.label} − ${b.label})`;
          const cumText = cumY.map((v, i) => {
            if (!Number.isFinite(v)) return "";
            return (
              `<span style="color:${CUM_DIFF_LINE_COLOR}">●</span> ${cumName}<br>` +
              `Σ ${short} Δ ${v.toFixed(4)} ${unit}` +
              (isElapsedPlotMode(mode)
                ? `<br>Elapsed ${diff.x[i].toFixed(2)} min`
                : `<br>${formatClockUtc(new Date(diff.x[i]))}`)
            );
          });
          traces.push({
            type: "scatter",
            mode: "lines",
            name: mi === 0 ? "Cumulative evaporation difference" : cumName,
            legendgroup: "cumulative",
            showlegend: mi === 0,
            x: xPlot,
            y: cumY.map((v) => (Number.isFinite(v) ? v : null)),
            text: cumText,
            yaxis: axisId(cumPanel),
            line: { color: CUM_DIFF_LINE_COLOR, width: 2.6 },
            connectgaps: false,
            hovertemplate: "%{text}<extra></extra>",
          });
        }
      }
    });

    if (isElapsedPlotMode(mode)) {
      shapes.push({
        type: "line",
        xref: "x",
        yref: "paper",
        x0: 0,
        x1: 0,
        y0: 0,
        y1: 1,
        line: { color: plotTheme.subtext, width: 1, dash: "dot" },
      });
    }

    const domainH = 1 / Math.max(n, 1);
    const gap = 0.06;
    const yAxes: Record<string, Partial<LayoutAxis>> = {};
    for (let panel = 0; panel < n; panel++) {
      const top = 1 - panel * domainH;
      const bottom = 1 - (panel + 1) * domainH + gap;
      const key = panel === 0 ? "yaxis" : `yaxis${panel + 1}`;
      const isCum = panel >= nMetric;
      const metric = metrics[isCum ? panel - nMetric : panel];
      const titleText = isCum
        ? `Cumulative Δ · ${METRIC_SHORT[metric].short}`
        : wantDiff
          ? `${METRIC_LABELS[metric]} (Δ)`
          : METRIC_LABELS[metric];
      yAxes[key] = {
        title: {
          text: titleText,
          font: { size: 11, color: plotTheme.text },
        },
        domain: [Math.max(0, bottom), top - 0.02],
        gridcolor: plotTheme.gridMajor,
        zeroline: true,
        zerolinecolor: plotTheme.subtext,
        tickfont: { color: plotTheme.subtext, size: 10 },
        automargin: true,
        autorange: false,
        range: paddedRange(metricValues[panel]),
      };
    }

    return { traces, shapes, yAxes, n, diffStats, wantDiff };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pointsKey,
    mode,
    metrics,
    showSmooth,
    fitKind,
    fullResolution,
    showDifference,
    showCumulativeDifference,
    labelA,
    labelB,
    plotTheme,
  ]);

  // Match portal body font for on-screen + PNG export (CSS vars like
  // var(--font-sans) do not resolve in Plotly's static image export).
  const [plotFontFamily, setPlotFontFamily] = useState(
    "Source Sans 3, sans-serif",
  );
  useEffect(() => {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) setPlotFontFamily(family);
  }, []);

  const chartTitle = useMemo(() => {
    const align =
      mode === "aligned"
        ? "session start"
        : mode === "trough"
          ? "AH trough"
          : "clock time";
    return `Aggregated · ${labelA} vs ${labelB} (${align})`;
  }, [mode, labelA, labelB]);

  const layout = useMemo((): Partial<Layout> => {
    return {
      title: undefined,
      paper_bgcolor: plotTheme.paper,
      plot_bgcolor: plotTheme.bg,
      font: { color: plotTheme.text, family: plotFontFamily, size: 12 },
      margin: { l: 64, r: 24, t: 40, b: 48 },
      height,
      showlegend: true,
      legend: {
        orientation: "h",
        y: 1.08,
        font: { size: 11, color: plotTheme.subtext, family: plotFontFamily },
      },
      xaxis: {
        title: {
          text: isElapsedPlotMode(mode)
            ? "Elapsed time (min)"
            : "Time (UTC)",
          font: {
            size: 11,
            color: plotTheme.subtext,
            family: plotFontFamily,
          },
        },
        type: isElapsedPlotMode(mode) ? "linear" : "date",
        gridcolor: plotTheme.gridMajor,
        tickfont: {
          color: plotTheme.subtext,
          size: 10,
          family: plotFontFamily,
        },
        ...(isElapsedPlotMode(mode)
          ? {}
          : { tickformat: "%H:%M" }),
      },
      ...base.yAxes,
      shapes: base.shapes,
      hovermode: "closest",
      uirevision: `agg-${mode}-${metrics.join("-")}-${colorMode}`,
    };
  }, [base.shapes, base.yAxes, height, metrics, mode, plotFontFamily, plotTheme, colorMode]);

  const mountKey = `${pointsKey}|${mode}|${metrics.join("-")}|${showSmooth}|${fitKind}|${fullResolution}|${showDifference}|${showCumulativeDifference}|${labelA}|${labelB}|${colorMode}`;

  const showStatsBox =
    (showDifference || showCumulativeDifference) && base.diffStats.length > 0;

  if (!PlotComponent) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-panel text-sm text-muted"
        style={{ height }}
      >
        Loading plot…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="px-0.5 text-sm font-semibold leading-snug text-foreground">
        {chartTitle}
      </h2>
      <div className="overflow-hidden rounded-lg border border-border bg-panel">
      {showStatsBox ? (
        <div className="space-y-2 border-b border-border px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Aggregated difference stats ({labelA} − {labelB} ·{" "}
            {fitKind === "exp" ? "exp" : "LOESS"} fits · overlap only)
          </div>
          <div className="flex flex-wrap gap-2">
            {base.diffStats.map((row) => {
              const { meanDelta, pValue, ci95, n, tStatistic } = row.stats;
              return (
                <div
                  key={row.metric}
                  className="min-w-[220px] flex-1 rounded border border-border bg-panel-elevated px-3 py-2 text-xs text-foreground"
                >
                  <div className="mb-1 font-semibold text-warning">
                    {row.label} Δ
                    <span className="ml-2 font-normal text-faint">
                      n={n}
                    </span>
                  </div>
                  <div className="grid gap-0.5 text-muted">
                    <div>
                      Mean Δ{" "}
                      <span className="text-foreground">
                        {formatSigned(meanDelta)} {row.unit}
                      </span>
                    </div>
                    <div>
                      ∫A−∫B{" "}
                      <span className="text-foreground">
                        {row.integralDelta == null
                          ? "—"
                          : `${formatSigned(row.integralDelta)} ${row.integralUnit}`}
                      </span>
                    </div>
                    <div>
                      Avg Δ (∫/Δt){" "}
                      <span className="text-foreground">
                        {row.meanFromIntegral == null
                          ? "—"
                          : `${formatSigned(row.meanFromIntegral)} ${row.unit}`}
                      </span>
                      {row.overlapMinutes != null ? (
                        <span className="text-faint">
                          {" "}
                          · {row.overlapMinutes.toFixed(1)} min overlap
                        </span>
                      ) : null}
                    </div>
                    <div>
                      t=
                      <span className="text-foreground">
                        {formatSigned(tStatistic, 3)}
                      </span>
                      {" · p="}
                      <span className="text-foreground">{formatPValue(pValue)}</span>
                    </div>
                    <div>
                      95% CI [{" "}
                      <span className="text-foreground">
                        {formatSigned(ci95[0])}
                      </span>
                      ,{" "}
                      <span className="text-foreground">
                        {formatSigned(ci95[1])}
                      </span>{" "}
                      ]
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <PlotComponent
        key={mountKey}
        data={base.traces}
        layout={layout}
        revision={plotRevision}
        config={{
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ["lasso2d", "select2d"],
          toImageButtonOptions: {
            format: "png",
            filename: "aggregate_sensor_plot",
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
