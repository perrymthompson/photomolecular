"use client";

/**
 * Static tables: Norm Rate comparisons for all non-X runs —
 * Light−Dark, hardware (matched condition), and angle (45° vs 90°).
 *
 * Align toggle: session start | AH trough | wall clock — recomputes all Δ grids.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  formatPValue,
  formatSigned,
  type DiffSeriesStats,
  type TwoSampleTTest,
} from "@/lib/diff-stats";
import { hardwareFromChamber } from "@/lib/plot-label";
import type {
  ComparisonBlock,
  NormRateRunStatsResult,
  PairStatRow,
} from "@/lib/norm-rate-run-stats";
import {
  NORM_RATE_ALIGN_MODES,
  type NormRateAlignMode,
} from "@/lib/norm-rate-align";
import type { ColorMode } from "@/lib/colors";

function formatCi(lo: number, hi: number): string {
  return `[${formatSigned(lo)}, ${formatSigned(hi)}]`;
}

const ALIGN_TOGGLE_LABEL: Record<NormRateAlignMode, string> = {
  session: "Session start",
  trough: "AH trough",
  clock: "Clock time",
};

/** Inline CSS vars so PNG export can force light/dark without flashing the site.
 * Sets both `--panel` and `--color-panel` (Tailwind v4 @theme maps color-* → these).
 */
const EXPORT_THEME_VARS: Record<ColorMode, Record<string, string>> = {
  dark: {
    background: "#121316",
    foreground: "#e8e8e8",
    panel: "#1e1f22",
    "panel-elevated": "#16171a",
    border: "#3a3b3f",
    muted: "#b5b5b8",
    faint: "#8a8a8d",
    surface: "#25262a",
    "surface-hover": "#2a2b2e",
    warning: "#f0ad4e",
    coral: "#e2574c",
    steel: "#4c8fd1",
  },
  light: {
    background: "#f4f5f7",
    foreground: "#1a1b1e",
    panel: "#ffffff",
    "panel-elevated": "#ffffff",
    border: "#d0d3d9",
    muted: "#5c5f66",
    faint: "#8a8d93",
    surface: "#eef0f3",
    "surface-hover": "#e4e6eb",
    warning: "#c98a1a",
    coral: "#d6453a",
    steel: "#3a7fc0",
  },
};

function exportThemeStyle(
  theme: ColorMode,
): Record<string, string> {
  const vars = EXPORT_THEME_VARS[theme];
  const style: Record<string, string> = {
    backgroundColor: vars.panel,
    color: vars.foreground,
    padding: "16px",
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
  for (const [k, v] of Object.entries(vars)) {
    style[`--${k}`] = v;
    style[`--color-${k}`] = v;
  }
  return style;
}

async function downloadNodePng(
  node: HTMLElement,
  theme: ColorMode,
  filename: string,
): Promise<void> {
  const vars = EXPORT_THEME_VARS[theme];
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: vars.panel,
    style: exportThemeStyle(theme),
    cacheBust: true,
  });
  const a = document.createElement("a");
  a.download = filename;
  a.href = dataUrl;
  a.click();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function chamberCell(chamber: string, plotLabel: string, name: string) {
  const hw = hardwareFromChamber(chamber);
  const hwTag = hw ? ` · ${hw}` : "";
  return (
    <span title={name}>
      <span className="text-muted">{chamber}</span>
      {hwTag ? <span className="text-faint">{hwTag}</span> : null}
      <span className="text-faint"> · </span>
      <span>{plotLabel || "—"}</span>
    </span>
  );
}

function AcrossRunsFooter({
  label,
  colSpan,
  stats,
}: {
  label: string;
  colSpan: number;
  stats: DiffSeriesStats | null;
}) {
  if (!stats) return null;
  return (
    <tfoot>
      <tr className="border-t border-border bg-panel-elevated text-foreground">
        <td className="px-2 py-2.5 font-semibold" colSpan={colSpan}>
          {label}
        </td>
        <td className="px-2 py-2.5 font-mono tabular-nums font-semibold text-warning">
          {formatSigned(stats.meanDelta)}
        </td>
        <td className="px-2 py-2.5 text-faint">—</td>
        <td className="px-2 py-2.5 text-faint">—</td>
        <td className="px-2 py-2.5 font-mono tabular-nums">
          {formatSigned(stats.tStatistic, 3)}
        </td>
        <td className="px-2 py-2.5 font-mono tabular-nums">
          {formatPValue(stats.pValue)}
        </td>
        <td className="px-2 py-2.5 font-mono tabular-nums whitespace-nowrap">
          {formatCi(stats.ci95[0], stats.ci95[1])}
        </td>
        <td className="px-2 py-2.5 font-mono tabular-nums">{stats.n}</td>
      </tr>
    </tfoot>
  );
}

function PairRows({
  rows,
  emptyMessage,
}: {
  rows: PairStatRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <tr>
        <td colSpan={11} className="px-2 py-6 text-center text-faint">
          {emptyMessage}
        </td>
      </tr>
    );
  }
  return (
    <>
      {rows.map((row) => (
        <tr
          key={`${row.dayKey}|${row.runKey}|${row.aId}|${row.bId}`}
          className="border-b border-border text-foreground"
        >
          <td className="px-2 py-2 whitespace-nowrap">{row.dayKey}</td>
          <td className="px-2 py-2 whitespace-nowrap">{row.runKey}</td>
          <td className="px-2 py-2">
            {chamberCell(row.aChamber, row.aPlotLabel, row.aName)}
          </td>
          <td className="px-2 py-2">
            {chamberCell(row.bChamber, row.bPlotLabel, row.bName)}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums">
            {formatSigned(row.stats.meanDelta)}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums">
            {row.integralDelta == null ? "—" : formatSigned(row.integralDelta)}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums">
            {row.meanFromIntegral == null
              ? "—"
              : formatSigned(row.meanFromIntegral)}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums">
            {formatSigned(row.stats.tStatistic, 3)}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums">
            {formatPValue(row.stats.pValue)}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums whitespace-nowrap">
            {formatCi(row.stats.ci95[0], row.stats.ci95[1])}
          </td>
          <td className="px-2 py-2 font-mono tabular-nums">{row.stats.n}</td>
        </tr>
      ))}
    </>
  );
}

function ComparisonTable({
  block,
  aHeader,
  bHeader,
  emptyMessage,
  alignLabel,
}: {
  block: ComparisonBlock;
  aHeader: string;
  bHeader: string;
  emptyMessage: string;
  alignLabel?: string;
}) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<ColorMode | null>(null);

  const exportPng = async (theme: ColorMode) => {
    const node = captureRef.current;
    if (!node || exporting) return;
    setExporting(theme);
    try {
      const align = alignLabel ? `-${slugify(alignLabel)}` : "";
      await downloadNodePng(
        node,
        theme,
        `norm-rate-${slugify(block.title)}${align}-${theme}.png`,
      );
    } catch (e) {
      console.error("Norm Rate table export failed", e);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-foreground">{block.title}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
            Δ = {block.deltaLabel}. {block.note}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!!exporting || block.rows.length === 0}
            onClick={() => void exportPng("dark")}
            className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            title="Download this table as a dark-theme PNG"
          >
            {exporting === "dark" ? "Exporting…" : "PNG dark"}
          </button>
          <button
            type="button"
            disabled={!!exporting || block.rows.length === 0}
            onClick={() => void exportPng("light")}
            className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            title="Download this table as a light-theme PNG"
          >
            {exporting === "light" ? "Exporting…" : "PNG light"}
          </button>
        </div>
      </div>

      <div
        ref={captureRef}
        className="rounded-lg border border-border bg-panel p-3"
      >
        <div className="mb-2">
          <div className="text-xs font-semibold text-foreground">
            {block.title}
            {alignLabel ? (
              <span className="ml-2 font-normal text-faint">
                · align: {alignLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
            Δ = {block.deltaLabel}. {block.note}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-faint">
                <th className="px-2 py-2 font-medium">Day</th>
                <th className="px-2 py-2 font-medium">Run</th>
                <th className="px-2 py-2 font-medium">{aHeader}</th>
                <th className="px-2 py-2 font-medium">{bHeader}</th>
                <th className="px-2 py-2 font-medium">Mean Δ</th>
                <th className="px-2 py-2 font-medium">∫A−∫B</th>
                <th className="px-2 py-2 font-medium">Avg Δ (∫/Δt)</th>
                <th className="px-2 py-2 font-medium">t</th>
                <th className="px-2 py-2 font-medium">p</th>
                <th className="px-2 py-2 font-medium">95% CI</th>
                <th className="px-2 py-2 font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              <PairRows rows={block.rows} emptyMessage={emptyMessage} />
            </tbody>
            <AcrossRunsFooter
              label="Across runs (t-test on per-run mean Δ)"
              colSpan={4}
              stats={block.acrossRuns}
            />
          </table>
        </div>
      </div>

      {block.skipped.length > 0 ? (
        <details className="text-[11px] text-faint">
          <summary className="cursor-pointer hover:text-muted">
            Skipped ({block.skipped.length})
          </summary>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {block.skipped.map((s) => (
              <li key={`${block.title}|${s.dayKey}|${s.runKey}|${s.reason}`}>
                {s.dayKey} · {s.runKey}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function WelchSummary({
  test,
  alignLabel,
}: {
  test: TwoSampleTTest | null;
  alignLabel?: string;
}) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<ColorMode | null>(null);

  const exportPng = async (theme: ColorMode) => {
    const node = captureRef.current;
    if (!node || exporting || !test) return;
    setExporting(theme);
    try {
      const align = alignLabel ? `-${slugify(alignLabel)}` : "";
      await downloadNodePng(
        node,
        theme,
        `norm-rate-welch-angle-effect${align}-${theme}.png`,
      );
    } catch (e) {
      console.error("Welch summary export failed", e);
    } finally {
      setExporting(null);
    }
  };

  if (!test) {
    return (
      <p className="text-[11px] text-faint">
        Need ≥2 runs at 45° and ≥2 at 90° to compare angle effect sizes.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">
          Angle effect (Welch)
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void exportPng("dark")}
            className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            {exporting === "dark" ? "Exporting…" : "PNG dark"}
          </button>
          <button
            type="button"
            disabled={!!exporting}
            onClick={() => void exportPng("light")}
            className="rounded border border-border px-2.5 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            {exporting === "light" ? "Exporting…" : "PNG light"}
          </button>
        </div>
      </div>
      <div
        ref={captureRef}
        className="rounded border border-border bg-panel-elevated px-3 py-2 text-xs text-foreground"
      >
        <div className="font-semibold text-warning">
          Welch test: mean(Light−Dark | 45°) − mean(Light−Dark | 90°)
          {alignLabel ? (
            <span className="ml-2 font-normal text-faint">
              · align: {alignLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-1 grid gap-0.5 text-muted sm:grid-cols-2">
          <div>
            Mean Δ @ 45°:{" "}
            <span className="font-mono text-foreground">
              {formatSigned(test.meanA)}
            </span>{" "}
            (n={test.nA} runs)
          </div>
          <div>
            Mean Δ @ 90°:{" "}
            <span className="font-mono text-foreground">
              {formatSigned(test.meanB)}
            </span>{" "}
            (n={test.nB} runs)
          </div>
          <div>
            Difference:{" "}
            <span className="font-mono text-foreground">
              {formatSigned(test.meanDiff)}
            </span>
          </div>
          <div>
            t={formatSigned(test.tStatistic, 3)} · p={formatPValue(test.pValue)} ·
            df={test.df.toFixed(1)}
          </div>
          <div className="sm:col-span-2">
            95% CI {formatCi(test.ci95[0], test.ci95[1])}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NormRateStatsTable() {
  const [alignMode, setAlignMode] = useState<NormRateAlignMode>("session");
  const [data, setData] = useState<NormRateRunStatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((mode: NormRateAlignMode) => {
    setLoading(true);
    setError(null);
    fetch(`/api/trials/norm-rate-stats?align=${mode}`)
      .then(async (r) => {
        const body = (await r.json()) as
          | NormRateRunStatsResult
          | { error?: string };
        if (!r.ok) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : "Failed to load Norm Rate stats",
          );
        }
        return body as NormRateRunStatsResult;
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(alignMode);
  }, [alignMode, load]);

  const alignLabel = data?.alignModeLabel ?? ALIGN_TOGGLE_LABEL[alignMode];

  return (
    <section className="rounded-lg border border-border bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Norm Rate stats — all runs (excl. X)
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-faint">
            Aligned Norm Rate Δ on overlapping time, one-sample t vs 0. Also
            reports ∫A−∫B and Avg Δ (∫/Δt) = (∫A−∫B) / overlap minutes. Toggle
            changes the comparison x-origin. Origins save best-effort to disk
            locally; on Vercel they are returned in the API response only
            (read-only FS). Use each table’s PNG dark / PNG light to export that
            table alone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(alignMode)}
          disabled={loading}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:border-faint hover:text-foreground disabled:opacity-50"
        >
          {loading ? "Computing…" : "Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-[11px] uppercase tracking-wide text-faint">
          Align by
        </span>
        <div className="flex rounded border border-border p-0.5">
          {NORM_RATE_ALIGN_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={loading}
              onClick={() => setAlignMode(mode)}
              title={
                mode === "session"
                  ? "x = minutes since sessionStartTime"
                  : mode === "trough"
                    ? "x = minutes since AH trough (t_start)"
                    : "x = absolute UTC time (wall clock overlap)"
              }
              className={`rounded px-3 py-1.5 text-xs disabled:opacity-50 ${
                alignMode === mode
                  ? "bg-surface-hover text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {ALIGN_TOGGLE_LABEL[mode]}
            </button>
          ))}
        </div>
        {data ? (
          <span className="text-[11px] text-faint">
            Active:{" "}
            <span className="text-warning">{data.alignModeLabel}</span>
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-coral">{error}</p>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-faint">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-steel border-t-transparent" />
          Loading all non-X trials and computing Norm Rate stats…
        </div>
      ) : null}

      {data ? (
        <div className={`space-y-8 px-4 py-4 ${loading ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap gap-3 text-[11px] text-faint">
            <span>
              Trials loaded:{" "}
              <span className="text-muted">{data.summary.trialCount}</span>
            </span>
            <span>
              Run groups:{" "}
              <span className="text-muted">{data.summary.runGroups}</span>
            </span>
            <span>
              Light−Dark pairs:{" "}
              <span className="text-muted">{data.summary.compared}</span>
            </span>
            <span>
              Excluded X:{" "}
              <span className="text-muted">{data.summary.excludedX}</span>
            </span>
            <span>
              Origins saved:{" "}
              <span className="text-muted">{data.origins.length}</span>
            </span>
          </div>

          <details className="text-xs text-faint">
            <summary className="cursor-pointer hover:text-muted">
              Saved start times (session / AH trough / recording) —{" "}
              {data.origins.length} trials
            </summary>
            <div className="mt-2 max-h-48 overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-border text-faint">
                    <th className="px-2 py-1 font-medium">File</th>
                    <th className="px-2 py-1 font-medium">Session</th>
                    <th className="px-2 py-1 font-medium">AH trough</th>
                    <th className="px-2 py-1 font-medium">Recording start</th>
                  </tr>
                </thead>
                <tbody>
                  {data.origins.map((o) => (
                    <tr
                      key={o.trialId}
                      className="border-b border-border text-muted"
                    >
                      <td className="px-2 py-1 whitespace-nowrap">
                        {o.filename.replace(/\.csv$/i, "")}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {o.sessionStartTime ?? "—"}
                      </td>
                      <td className="px-2 py-1 font-mono text-warning">
                        {o.ahTroughTime ?? "—"}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {o.recordingStartTime ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <ComparisonTable
            block={data.lightMinusDark}
            aHeader="Light (+)"
            bHeader="Dark (−)"
            emptyMessage="No Light/Dark pairs found among non-X runs."
            alignLabel={alignLabel}
          />

          <div className="space-y-6 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground">
              Hardware checks
            </h3>
            <ComparisonTable
              block={data.lightOnCh1}
              aHeader="Light on ch1 (+)"
              bHeader="Dark (−)"
              emptyMessage="No runs with Light on ch1."
              alignLabel={alignLabel}
            />
            <ComparisonTable
              block={data.lightOnCh2}
              aHeader="Light on ch2 (+)"
              bHeader="Dark (−)"
              emptyMessage="No runs with Light on ch2."
              alignLabel={alignLabel}
            />
            <ComparisonTable
              block={data.hardwareMatched}
              aHeader="ch1 New (+)"
              bHeader="ch2 Old (−)"
              emptyMessage="No same-condition ch1/ch2 pairs (both Dark or both Light)."
              alignLabel={alignLabel}
            />
          </div>

          <div className="space-y-6 border-t border-border pt-6">
            <h3 className="text-sm font-semibold text-foreground">Angle checks</h3>
            <ComparisonTable
              block={data.angle45Minus90}
              aHeader="Light 45° (+)"
              bHeader="Light 90° (−)"
              emptyMessage="No runs with both Light 45° and Light 90°."
              alignLabel={alignLabel}
            />
            <ComparisonTable
              block={data.lightDarkAngle45}
              aHeader="Light 45° (+)"
              bHeader="Dark (−)"
              emptyMessage="No Light−Dark pairs with Light @ 45°."
              alignLabel={alignLabel}
            />
            <ComparisonTable
              block={data.lightDarkAngle90}
              aHeader="Light 90° (+)"
              bHeader="Dark (−)"
              emptyMessage="No Light−Dark pairs with Light @ 90°."
              alignLabel={alignLabel}
            />
            <WelchSummary test={data.angleEffectWelch} alignLabel={alignLabel} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
