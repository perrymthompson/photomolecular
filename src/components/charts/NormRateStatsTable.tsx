"use client";

/**
 * Static table: Norm Rate Light − Dark stats for every non-X day/run.
 * Fetches GET /api/trials/norm-rate-stats (independent of plot selection).
 */

import { useCallback, useEffect, useState } from "react";
import { formatPValue, formatSigned } from "@/lib/diff-stats";
import type { NormRateRunStatsResult } from "@/lib/norm-rate-run-stats";

function formatCi(lo: number, hi: number): string {
  return `[${formatSigned(lo)}, ${formatSigned(hi)}]`;
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
            Per day/run: aligned Norm Rate Δ = Light − Dark on the overlapping
            elapsed-time window, then one-sample t-test vs 0 (same method as Diff
            on the plot). Run X full-day composites are excluded.
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
        <div className="space-y-4 px-4 py-3">
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
              Compared:{" "}
              <span className="text-[#c8c8cb]">{data.summary.compared}</span>
            </span>
            <span>
              Excluded X files:{" "}
              <span className="text-[#c8c8cb]">{data.summary.excludedX}</span>
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#3a3b3f] text-[11px] uppercase tracking-wide text-[#8a8a8d]">
                  <th className="px-2 py-2 font-medium">Day</th>
                  <th className="px-2 py-2 font-medium">Run</th>
                  <th className="px-2 py-2 font-medium">Light</th>
                  <th className="px-2 py-2 font-medium">Dark</th>
                  <th className="px-2 py-2 font-medium">Mean Δ</th>
                  <th className="px-2 py-2 font-medium">t</th>
                  <th className="px-2 py-2 font-medium">p</th>
                  <th className="px-2 py-2 font-medium">95% CI</th>
                  <th className="px-2 py-2 font-medium">n</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-2 py-6 text-center text-[#8a8a8d]"
                    >
                      No Light/Dark pairs found among non-X runs.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr
                      key={`${row.dayKey}|${row.runKey}|${row.lightId}|${row.darkId}`}
                      className="border-b border-[#2a2b2e] text-[#e8e8e8]"
                    >
                      <td className="px-2 py-2 whitespace-nowrap">
                        {row.dayKey}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {row.runKey}
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-[#E0A04A]">{row.lightName}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-[#5B8DEF]">{row.darkName}</span>
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
                      <td className="px-2 py-2 font-mono tabular-nums">
                        {row.stats.n}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {data.acrossRuns ? (
                <tfoot>
                  <tr className="border-t border-[#3a3b3f] bg-[#16171a] text-[#e8e8e8]">
                    <td className="px-2 py-2.5 font-semibold" colSpan={4}>
                      Across runs (t-test on per-run mean Δ)
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums font-semibold text-[#E8C547]">
                      {formatSigned(data.acrossRuns.meanDelta)}
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums">
                      {formatSigned(data.acrossRuns.tStatistic, 3)}
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums">
                      {formatPValue(data.acrossRuns.pValue)}
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums whitespace-nowrap">
                      {formatCi(
                        data.acrossRuns.ci95[0],
                        data.acrossRuns.ci95[1],
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-mono tabular-nums">
                      {data.acrossRuns.n}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {data.skipped.length > 0 ? (
            <details className="text-xs text-[#8a8a8d]">
              <summary className="cursor-pointer hover:text-[#c8c8cb]">
                Skipped runs ({data.skipped.length})
              </summary>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {data.skipped.map((s) => (
                  <li key={`${s.dayKey}|${s.runKey}|${s.reason}`}>
                    {s.dayKey} · {s.runKey}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
