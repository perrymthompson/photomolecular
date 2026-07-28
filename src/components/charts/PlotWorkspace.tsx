"use client";

import dynamic from "next/dynamic";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PlotBookmarkAdd,
  type BookmarkPrefill,
} from "@/components/charts/PlotBookmarkAdd";
import { TrialSelector } from "@/components/charts/TrialSelector";
import { selectionSpansMultipleRuns, sortTrials } from "@/lib/trial-sort";
import type { MetricKey, PlotMode, TrialMeta, TrialSeries } from "@/types/trial";

const PLOT_WORKSPACE_STORAGE_KEY = "plot-workspace-state-v1";

type PlotView = "combined" | "ah" | "rh" | "temp";

type PersistedPlotWorkspaceState = {
  selectedIds?: string[];
  mode?: PlotMode;
  view?: PlotView;
  showSmooth?: boolean;
  showBookmarks?: boolean;
  fullResolution?: boolean;
  modeTouched?: boolean;
};

const SensorPlot = dynamic(
  () => import("@/components/charts/SensorPlot").then((mod) => mod.SensorPlot),
  { ssr: false },
);

function ToggleGroup({
  labelOn,
  labelOff,
  on,
  onChange,
  title,
}: {
  labelOn: string;
  labelOff: string;
  on: boolean;
  onChange: (next: boolean) => void;
  title?: string;
}) {
  return (
    <div className="flex rounded border border-[#3a3b3f] p-0.5" title={title}>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`rounded px-3 py-1.5 text-xs ${
          on ? "bg-[#2a2b2e] text-white" : "text-[#b5b5b8] hover:text-white"
        }`}
      >
        {labelOn}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`rounded px-3 py-1.5 text-xs ${
          !on ? "bg-[#2a2b2e] text-white" : "text-[#b5b5b8] hover:text-white"
        }`}
      >
        {labelOff}
      </button>
    </div>
  );
}

function resolutionToggleTitle(fullResolution: boolean): string {
  if (fullResolution) {
    return "Full res: every CSV row. Real sensor outages longer than 10 seconds are shown as gaps, and LOWESS is fit separately on each continuous run.";
  }
  return "Sampled mode: about 1800 evenly spaced points per trial for speed. Gap detection is disabled here because sampling can skip the exact outage boundaries and create misleading breaks or connections. Turn on Full res to see true gaps longer than 10 seconds.";
}

export function PlotWorkspace() {
  const [trials, setTrials] = useState<TrialMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [series, setSeries] = useState<TrialSeries[]>([]);
  const [mode, setMode] = useState<PlotMode>("calendar");
  const [view, setView] = useState<PlotView>("combined");
  const [showSmooth, setShowSmooth] = useState(true);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [fullResolution, setFullResolution] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plotBusy, setPlotBusy] = useState(false);
  const [plotRevision, setPlotRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modeTouched, setModeTouched] = useState(false);
  const [bookmarkPrefill, setBookmarkPrefill] = useState<BookmarkPrefill | null>(
    null,
  );
  const restoredSelectedIdsRef = useRef<string[] | null>(null);
  const storageReadyRef = useRef(false);
  const skipFirstPersistRef = useRef(true);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PLOT_WORKSPACE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedPlotWorkspaceState;
      if (parsed.mode === "calendar" || parsed.mode === "aligned") {
        setMode(parsed.mode);
      }
      if (
        parsed.view === "combined" ||
        parsed.view === "ah" ||
        parsed.view === "rh" ||
        parsed.view === "temp"
      ) {
        setView(parsed.view);
      }
      if (typeof parsed.showSmooth === "boolean") setShowSmooth(parsed.showSmooth);
      if (typeof parsed.showBookmarks === "boolean") {
        setShowBookmarks(parsed.showBookmarks);
      }
      if (typeof parsed.fullResolution === "boolean") {
        setFullResolution(parsed.fullResolution);
      }
      if (typeof parsed.modeTouched === "boolean") {
        setModeTouched(parsed.modeTouched);
      } else if (parsed.mode) {
        setModeTouched(true);
      }
      if (Array.isArray(parsed.selectedIds)) {
        restoredSelectedIdsRef.current = parsed.selectedIds;
      }
    } catch {
      // Ignore corrupted persisted state and fall back to defaults.
    } finally {
      storageReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    fetch("/api/trials")
      .then(async (r) => {
        const data = (await r.json()) as TrialMeta[] | { error?: string };
        if (!r.ok) {
          throw new Error(
            typeof data === "object" && data && "error" in data
              ? (data.error ?? "Failed to load trials")
              : "Failed to load trials",
          );
        }
        if (!Array.isArray(data)) {
          throw new Error("Trials API returned an unexpected response.");
        }
        return sortTrials(data);
      })
      .then((data) => {
        setTrials(data);
        if (data.length) {
          const restoredIds = (restoredSelectedIdsRef.current ?? []).filter((id) =>
            data.some((t) => t.id === id),
          );
          setSelectedIds(
            restoredIds.length
              ? restoredIds
              : data.slice(0, Math.min(2, data.length)).map((t) => t.id),
          );
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!storageReadyRef.current) return;
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }
    const next: PersistedPlotWorkspaceState = {
      selectedIds,
      mode,
      view,
      showSmooth,
      showBookmarks,
      fullResolution,
      modeTouched,
    };
    window.sessionStorage.setItem(
      PLOT_WORKSPACE_STORAGE_KEY,
      JSON.stringify(next),
    );
  }, [selectedIds, mode, view, showSmooth, showBookmarks, fullResolution, modeTouched]);

  const loadSeries = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setSeries([]);
      return;
    }
    setLoading(true);
    setPlotBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trials/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      const loaded = (await res.json()) as TrialSeries[];
      setSeries(loaded);

      if (!modeTouched) {
        const metas = loaded.map((s) => s.meta);
        const allHaveStart = metas.every((m) => m.sessionStartTime);
        if (selectionSpansMultipleRuns(metas) && allHaveStart) {
          setMode("aligned");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load series");
    } finally {
      setLoading(false);
      setPlotBusy(false);
      setPlotRevision((n) => n + 1);
    }
  }, [modeTouched]);

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

  const alignedReady = series.length > 0 && series.every((s) => s.meta.sessionStartTime);
  const visibleSeries = useMemo(
    () =>
      mode === "aligned"
        ? series.filter((s) => s.meta.sessionStartTime)
        : series,
    [mode, series],
  );

  const bumpPlot = () => {
    setPlotBusy(true);
    setPlotRevision((n) => n + 1);
    window.setTimeout(() => setPlotBusy(false), 350);
  };

  const setViewAndRefresh = (next: typeof view) => {
    setView(next);
    bumpPlot();
  };

  const setModeAndRefresh = (next: PlotMode) => {
    setModeTouched(true);
    setMode(next);
    bumpPlot();
  };

  const setSmoothAndRefresh = (next: boolean) => {
    setShowSmooth(next);
    bumpPlot();
  };

  const setBookmarksAndRefresh = (next: boolean) => {
    setShowBookmarks(next);
    bumpPlot();
  };

  const setFullResolutionAndRefresh = (next: boolean) => {
    setFullResolution(next);
    bumpPlot();
  };

  const plotHeight = mode === "aligned" || view !== "combined" ? 480 : 720;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-3 rounded-lg border border-[#3a3b3f] bg-[#16171a] p-3">
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
                onClick={() => setViewAndRefresh(k)}
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
              onClick={() => setModeAndRefresh("calendar")}
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
              onClick={() => setModeAndRefresh("aligned")}
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

          <ToggleGroup
            labelOn="Fit on"
            labelOff="Fit off"
            on={showSmooth}
            onChange={setSmoothAndRefresh}
            title="Toggle LOWESS smooth fit curves"
          />

          <ToggleGroup
            labelOn="Bookmarks on"
            labelOff="Bookmarks off"
            on={showBookmarks}
            onChange={setBookmarksAndRefresh}
            title="Toggle time bookmark markers"
          />

          <ToggleGroup
            labelOn="Full res"
            labelOff="Sampled"
            on={fullResolution}
            onChange={setFullResolutionAndRefresh}
            title={resolutionToggleTitle(fullResolution)}
          />

          {loading || plotBusy ? (
            <span className="flex items-center gap-2 text-xs text-[#8a8a8d]">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#4C8FD1] border-t-transparent" />
              {loading ? "Loading data…" : "Updating plot…"}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="rounded border border-[#E2574C]/40 bg-[#E2574C]/10 px-3 py-2 text-sm text-[#E2574C]">
            {error}
          </p>
        ) : null}

        <div
          className={`relative ${loading || plotBusy ? "pointer-events-none" : ""}`}
        >
          {(loading || plotBusy) && visibleSeries.length > 0 ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#1e1f22]/70 backdrop-blur-[1px]">
              <span className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#4C8FD1] border-t-transparent" />
                Loading plot…
              </span>
            </div>
          ) : null}

          {visibleSeries.length > 0 ? (
            <SensorPlot
              series={visibleSeries}
              mode={mode}
              metrics={mode === "aligned" ? ["absHumidity"] : metrics}
              height={plotHeight}
              plotRevision={plotRevision}
              showSmooth={showSmooth}
              showBookmarks={showBookmarks}
              fullResolution={fullResolution}
              onTimePick={({ trialId, time }) => {
                setBookmarkPrefill({
                  trialId,
                  time,
                  nonce: Date.now(),
                });
              }}
            />
          ) : (
            <div className="flex h-[480px] items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
              {mode === "aligned" && series.length > 0
                ? "Selected trials need session start times (set them on Dashboard)."
                : "Select one or more trials to plot."}
            </div>
          )}
        </div>

        {visibleSeries.length > 0 ? (
          <PlotBookmarkAdd
            series={visibleSeries}
            prefill={bookmarkPrefill}
            onSaved={(updated) => {
              startTransition(() => {
                setTrials((prev) =>
                  sortTrials(
                    prev.map((t) => (t.id === updated.id ? updated : t)),
                  ),
                );
                setSeries((prev) =>
                  prev.map((s) =>
                    s.meta.id === updated.id ? { ...s, meta: updated } : s,
                  ),
                );
              });
            }}
          />
        ) : null}
      </section>
    </div>
  );
}
