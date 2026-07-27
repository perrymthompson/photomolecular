"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { TrialSelector } from "@/components/charts/TrialSelector";
import type { MetricKey, PlotMode, TrialMeta, TrialSeries } from "@/types/trial";

const SensorPlot = dynamic(
  () => import("@/components/charts/SensorPlot").then((mod) => mod.SensorPlot),
  { ssr: false },
);

export function PlotWorkspace() {
  const [trials, setTrials] = useState<TrialMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [series, setSeries] = useState<TrialSeries[]>([]);
  const [mode, setMode] = useState<PlotMode>("calendar");
  const [view, setView] = useState<"combined" | "ah" | "rh" | "temp">("combined");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/trials")
      .then((r) => r.json())
      .then((data: TrialMeta[]) => {
        setTrials(data);
        // Pre-select first two if available (R script minimum)
        if (data.length) {
          setSelectedIds(data.slice(0, Math.min(2, data.length)).map((t) => t.id));
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const loadSeries = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setSeries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trials/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSeries((await res.json()) as TrialSeries[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load series");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSeries(selectedIds);
  }, [selectedIds, loadSeries]);

  const metrics: MetricKey[] =
    view === "combined"
      ? ["absHumidity", "rh", "temp"]
      : view === "ah"
        ? ["absHumidity"]
        : view === "rh"
          ? ["rh"]
          : ["temp"];

  const alignedReady = series.every((s) => s.meta.sessionStartTime);
  const visibleSeries =
    mode === "aligned" ? series.filter((s) => s.meta.sessionStartTime) : series;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4 rounded-lg border border-[#3a3b3f] bg-[#16171a] p-4">
        <h2 className="text-sm font-semibold text-white">Trials</h2>
        <TrialSelector
          trials={trials}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
      </aside>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded border border-[#3a3b3f] p-0.5">
            {(
              [
                ["combined", "Combined"],
                ["ah", "AH"],
                ["rh", "RH"],
                ["temp", "Temp"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                className={`rounded px-3 py-1.5 text-xs ${
                  view === k
                    ? "bg-[#2a2b2e] text-white"
                    : "text-[#b5b5b8] hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex rounded border border-[#3a3b3f] p-0.5">
            <button
              type="button"
              onClick={() => setMode("calendar")}
              className={`rounded px-3 py-1.5 text-xs ${
                mode === "calendar"
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
              }`}
            >
              Clock time
            </button>
            <button
              type="button"
              onClick={() => setMode("aligned")}
              disabled={!alignedReady && series.length > 0}
              title={
                alignedReady
                  ? "Align by session start"
                  : "Set session start times in Dashboard first"
              }
              className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "aligned"
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
              }`}
            >
              Align session starts
            </button>
          </div>

          {loading ? (
            <span className="text-xs text-[#8a8a8d]">Loading…</span>
          ) : null}
        </div>

        {error ? (
          <p className="rounded border border-[#E2574C]/40 bg-[#E2574C]/10 px-3 py-2 text-sm text-[#E2574C]">
            {error}
          </p>
        ) : null}

        {visibleSeries.length > 0 ? (
          <SensorPlot
            series={visibleSeries}
            mode={mode}
            metrics={mode === "aligned" ? ["absHumidity"] : metrics}
            height={mode === "aligned" || view !== "combined" ? 480 : 720}
          />
        ) : (
          <div className="flex h-[480px] items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
            Select one or more trials to plot.
          </div>
        )}
      </section>
    </div>
  );
}
