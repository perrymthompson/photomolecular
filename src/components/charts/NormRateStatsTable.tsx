"use client";

/**
 * Static tables: Norm Rate comparisons for all non-X runs —
 * Light−Dark, hardware (matched condition), and angle (45° vs 90°).
 */

import { useCallback, useEffect, useState } from "react";
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

function formatCi(lo: number, hi: number): string {
  return `[${formatSigned(lo)}, ${formatSigned(hi)}]`;
}

function chamberCell(chamber: string, plotLabel: string, name: string) {
  const hw = hardwareFromChamber(chamber);
  const hwTag = hw ? ` · ${hw}` : "";
  return (
    <span title={name}>
      <span className="text-[#c8c8cb]">{chamber}</span>
      {hwTag ? <span className="text-[#8a8a8d]">{hwTag}</span> : null}
      <span className="text-[#8a8a8d]"> · </span>
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
      <tr className="border-t border-[#3a3b3f] bg-[#16171a] text-[#e8e8e8]">
        <td className="px-2 py-2.5 font-semibold" colSpan={colSpan}>
          {label}
        </td>
        <td className="px-2 py-2.5 font-mono tabular-nums font-semibold text-[#E8C547]">
          {formatSigned(stats.meanDelta)}
        </td>
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
        <td colSpan={8} className="px-2 py-6 text-center text-[#8a8a8d]">
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
          className="border-b border-[#2a2b2e] text-[#e8e8e8]"
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
}: {
  block: ComparisonBlock;
  aHeader: string;
  bHeader: string;
  emptyMessage: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold text-white">{block.title}</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#8a8a8d]">
          Δ = {block.deltaLabel}. {block.note}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#3a3b3f] text-[11px] uppercase tracking-wide text-[#8a8a8d]">
              <th className="px-2 py-2 font-medium">Day</th>
              <th className="px-2 py-2 font-medium">Run</th>
              <th className="px-2 py-2 font-medium">{aHeader}</th>
              <th className="px-2 py-2 font-medium">{bHeader}</th>
              <th className="px-2 py-2 font-medium">Mean Δ</th>
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
      {block.skipped.length > 0 ? (
        <details className="text-[11px] text-[#8a8a8d]">
          <summary className="cursor-pointer hover:text-[#c8c8cb]">
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

function WelchSummary({ test }: { test: TwoSampleTTest | null }) {
  if (!test) {
    return (
      <p className="text-[11px] text-[#8a8a8d]">
        Need ≥2 runs at 45° and ≥2 at 90° to compare angle effect sizes.
      </p>
    );
  }
  return (
    <div className="rounded border border-[#3a3b3f] bg-[#16171a] px-3 py-2 text-xs text-[#e8e8e8]">
      <div className="font-semibold text-[#E8C547]">
        Welch test: mean(Light−Dark | 45°) − mean(Light−Dark | 90°)
      </div>
      <div className="mt-1 grid gap-0.5 text-[#c8c8cb] sm:grid-cols-2">
        <div>
          Mean Δ @ 45°:{" "}
          <span className="font-mono text-white">
            {formatSigned(test.meanA)}
          </span>{" "}
          (n={test.nA} runs)
        </div>
        <div>
          Mean Δ @ 90°:{" "}
          <span className="font-mono text-white">
            {formatSigned(test.meanB)}
          </span>{" "}
          (n={test.nB} runs)
        </div>
        <div>
          Difference:{" "}
          <span className="font-mono text-white">
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
  );
}

export function NormRateStatsTable() {
  const [data, setData] = useState<NormRateRunStatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/trials/norm-rate-stats")
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
    load();
  }, [load]);

  return (
    <section className="rounded-lg border border-[#3a3b3f] bg-[#1e1f22]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#3a3b3f] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Norm Rate stats — all runs (excl. X)
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#8a8a8d]">
            Aligned Norm Rate Δ on overlapping elapsed time, one-sample t vs 0
            (same method as plot Diff). Extra blocks separate{" "}
            <span className="text-[#c8c8cb]">hardware</span> (ch1/New vs
            ch2/Old) from <span className="text-[#c8c8cb]">angle</span> (45° vs
            90°).
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded border border-[#3a3b3f] px-3 py-1.5 text-xs text-[#c8c8cb] hover:border-[#5a5b5f] hover:text-white disabled:opacity-50"
        >
          {loading ? "Computing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-[#E2574C]">{error}</p>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-[#8a8a8d]">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#4C8FD1] border-t-transparent" />
          Loading all non-X trials and computing Norm Rate stats…
        </div>
      ) : null}

      {data ? (
        <div className="space-y-8 px-4 py-4">
          <div className="flex flex-wrap gap-3 text-[11px] text-[#8a8a8d]">
            <span>
              Trials loaded:{" "}
              <span className="text-[#c8c8cb]">{data.summary.trialCount}</span>
            </span>
            <span>
              Run groups:{" "}
              <span className="text-[#c8c8cb]">{data.summary.runGroups}</span>
            </span>
            <span>
              Light−Dark pairs:{" "}
              <span className="text-[#c8c8cb]">{data.summary.compared}</span>
            </span>
            <span>
              Excluded X:{" "}
              <span className="text-[#c8c8cb]">{data.summary.excludedX}</span>
            </span>
          </div>

          <ComparisonTable
            block={data.lightMinusDark}
            aHeader="Light (+)"
            bHeader="Dark (−)"
            emptyMessage="No Light/Dark pairs found among non-X runs."
          />

          <div className="space-y-6 border-t border-[#3a3b3f] pt-6">
            <h3 className="text-sm font-semibold text-white">
              Hardware checks
            </h3>
            <ComparisonTable
              block={data.lightOnCh1}
              aHeader="Light on ch1 (+)"
              bHeader="Dark (−)"
              emptyMessage="No runs with Light on ch1."
            />
            <ComparisonTable
              block={data.lightOnCh2}
              aHeader="Light on ch2 (+)"
              bHeader="Dark (−)"
              emptyMessage="No runs with Light on ch2."
            />
            <ComparisonTable
              block={data.hardwareMatched}
              aHeader="ch1 New (+)"
              bHeader="ch2 Old (−)"
              emptyMessage="No same-condition ch1/ch2 pairs (both Dark or both Light)."
            />
          </div>

          <div className="space-y-6 border-t border-[#3a3b3f] pt-6">
            <h3 className="text-sm font-semibold text-white">Angle checks</h3>
            <ComparisonTable
              block={data.angle45Minus90}
              aHeader="Light 45° (+)"
              bHeader="Light 90° (−)"
              emptyMessage="No runs with both Light 45° and Light 90°."
            />
            <ComparisonTable
              block={data.lightDarkAngle45}
              aHeader="Light 45° (+)"
              bHeader="Dark (−)"
              emptyMessage="No Light−Dark pairs with Light @ 45°."
            />
            <ComparisonTable
              block={data.lightDarkAngle90}
              aHeader="Light 90° (+)"
              bHeader="Dark (−)"
              emptyMessage="No Light−Dark pairs with Light @ 90°."
            />
            <WelchSummary test={data.angleEffectWelch} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
