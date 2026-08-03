"use client";

import dynamic from "next/dynamic";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PlotBookmarkAdd,
  type BookmarkPrefill,
} from "@/components/charts/PlotBookmarkAdd";
import { NormRateStatsTable } from "@/components/charts/NormRateStatsTable";
import { PlotTrialNotes } from "@/components/charts/PlotTrialNotes";
import { TrialSelector } from "@/components/charts/TrialSelector";
import { selectionSpansMultipleRuns, sortTrials } from "@/lib/trial-sort";
import { usePrefersNarrow } from "@/lib/use-media-query";
import type { MetricKey, PlotMode, TrialMeta, TrialSeries } from "@/types/trial";
import { isElapsedPlotMode } from "@/types/trial";
import { detectAhTurnaround } from "@/lib/derived-metrics";
import { sessionStartIso } from "@/lib/parse-csv";

const PLOT_WORKSPACE_STORAGE_KEY = "plot-workspace-state-v1";
const TRIALS_PANEL_SIZE_KEY = "plot-trials-panel-size-v1";
const TRIALS_PANEL_DEFAULT = { width: 280, height: 360 };
const TRIALS_PANEL_MIN = { width: 200, height: 200 };
const TRIALS_PANEL_MAX = { width: 520, height: 900 };

type PlotView =
  | "combined"
  | "ah"
  | "rh"
  | "temp"
  | "ahRate"
  | "vpd"
  | "normRate"
  | "ahRateVsVpd";

type PersistedPlotWorkspaceState = {
  selectedIds?: string[];
  mode?: PlotMode;
  view?: PlotView;
  showSmooth?: boolean;
  showBookmarks?: boolean;
  fullResolution?: boolean;
  poolLightDark?: boolean;
  modeTouched?: boolean;
};

const SensorPlot = dynamic(
  () => import("@/components/charts/SensorPlot").then((mod) => mod.SensorPlot),
  { ssr: false },
);

const EvapRateVsVpdPlot = dynamic(
  () =>
    import("@/components/charts/EvapRateVsVpdPlot").then(
      (mod) => mod.EvapRateVsVpdPlot,
    ),
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
    <div className="flex rounded border border-border p-0.5" title={title}>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`rounded px-3 py-1.5 text-xs ${
          on ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        {labelOn}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`rounded px-3 py-1.5 text-xs ${
          !on ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"
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
  const isNarrow = usePrefersNarrow();
  const [trials, setTrials] = useState<TrialMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [series, setSeries] = useState<TrialSeries[]>([]);
  const [mode, setMode] = useState<PlotMode>("calendar");
  const [view, setView] = useState<PlotView>("combined");
  const [showSmooth, setShowSmooth] = useState(true);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [fullResolution, setFullResolution] = useState(false);
  const [poolLightDark, setPoolLightDark] = useState(false);
  const [showDifference, setShowDifference] = useState(true);
  const [showCumulativeDifference, setShowCumulativeDifference] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [plotBusy, setPlotBusy] = useState(false);
  const [plotRevision, setPlotRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modeTouched, setModeTouched] = useState(false);
  const [bookmarkPrefill, setBookmarkPrefill] = useState<BookmarkPrefill | null>(
    null,
  );
  const [panelWidth, setPanelWidth] = useState(TRIALS_PANEL_DEFAULT.width);
  const [panelHeight, setPanelHeight] = useState(TRIALS_PANEL_DEFAULT.height);
  const restoredSelectedIdsRef = useRef<string[] | null>(null);
  const storageReadyRef = useRef(false);
  const skipFirstPersistRef = useRef(true);
  const dragRef = useRef<{
    kind: "width" | "height" | "both";
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRIALS_PANEL_SIZE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { width?: number; height?: number };
      if (typeof parsed.width === "number") {
        setPanelWidth(
          Math.min(
            TRIALS_PANEL_MAX.width,
            Math.max(TRIALS_PANEL_MIN.width, parsed.width),
          ),
        );
      }
      if (typeof parsed.height === "number") {
        setPanelHeight(
          Math.min(
            TRIALS_PANEL_MAX.height,
            Math.max(TRIALS_PANEL_MIN.height, parsed.height),
          ),
        );
      }
    } catch {
      // ignore corrupt size prefs
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TRIALS_PANEL_SIZE_KEY,
        JSON.stringify({ width: panelWidth, height: panelHeight }),
      );
    } catch {
      // ignore quota / private mode
    }
  }, [panelWidth, panelHeight]);

  const startPanelDrag = (
    kind: "width" | "height" | "both",
    e: ReactPointerEvent,
  ) => {
    e.preventDefault();
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      startW: panelWidth,
      startH: panelHeight,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPanelDrag = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "width" || drag.kind === "both") {
      const next = drag.startW + (e.clientX - drag.startX);
      setPanelWidth(
        Math.min(TRIALS_PANEL_MAX.width, Math.max(TRIALS_PANEL_MIN.width, next)),
      );
    }
    if (drag.kind === "height" || drag.kind === "both") {
      const next = drag.startH + (e.clientY - drag.startY);
      setPanelHeight(
        Math.min(
          TRIALS_PANEL_MAX.height,
          Math.max(TRIALS_PANEL_MIN.height, next),
        ),
      );
    }
  };

  const endPanelDrag = () => {
    dragRef.current = null;
  };

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PLOT_WORKSPACE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedPlotWorkspaceState;
      if (
        parsed.mode === "calendar" ||
        parsed.mode === "aligned" ||
        parsed.mode === "trough"
      ) {
        setMode(parsed.mode);
      }
      if (
        parsed.view === "combined" ||
        parsed.view === "ah" ||
        parsed.view === "rh" ||
        parsed.view === "temp" ||
        parsed.view === "ahRate" ||
        parsed.view === "vpd" ||
        parsed.view === "normRate" ||
        parsed.view === "ahRateVsVpd"
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
      if (typeof parsed.poolLightDark === "boolean") {
        setPoolLightDark(parsed.poolLightDark);
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
      poolLightDark,
      modeTouched,
    };
    window.sessionStorage.setItem(
      PLOT_WORKSPACE_STORAGE_KEY,
      JSON.stringify(next),
    );
  }, [selectedIds, mode, view, showSmooth, showBookmarks, fullResolution, poolLightDark, modeTouched]);

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

  const isScatterView = view === "ahRateVsVpd";

  const metrics: MetricKey[] =
    view === "combined"
      ? ["absHumidity", "rh", "temp", "ahRate"]
      : view === "ah"
        ? ["absHumidity"]
        : view === "rh"
          ? ["rh"]
          : view === "temp"
            ? ["temp"]
            : view === "ahRate"
              ? ["ahRate"]
              : view === "vpd"
                ? ["vpd"]
                : view === "normRate"
                  ? ["normRate"]
                  : ["absHumidity"];

  const alignedReady = series.length > 0 && series.every((s) => s.meta.sessionStartTime);
  const troughReady = useMemo(() => {
    if (series.length === 0) return false;
    return series.every((s) => {
      const startIso = sessionStartIso(
        s.points[0]?.time,
        s.meta.sessionStartTime,
      );
      const sessionStartMs = startIso ? Date.parse(startIso) : null;
      return Boolean(
        detectAhTurnaround(
          s.points,
          Number.isFinite(sessionStartMs) ? sessionStartMs : null,
        ),
      );
    });
  }, [series]);
  const visibleSeries = useMemo(() => {
    const filtered =
      isScatterView || mode === "calendar"
        ? series
        : mode === "aligned"
          ? series.filter((s) => s.meta.sessionStartTime)
          : series.filter((s) => {
              const startIso = sessionStartIso(
                s.points[0]?.time,
                s.meta.sessionStartTime,
              );
              const sessionStartMs = startIso ? Date.parse(startIso) : null;
              return Boolean(
                detectAhTurnaround(
                  s.points,
                  Number.isFinite(sessionStartMs) ? sessionStartMs : null,
                ),
              );
            });
    // Keep trial-selector order so Diff = first selected − second selected.
    const byId = new Map(filtered.map((s) => [s.meta.id, s]));
    const ordered = selectedIds
      .map((id) => byId.get(id))
      .filter((s): s is TrialSeries => Boolean(s));
    return ordered.length > 0 ? ordered : filtered;
  }, [isScatterView, mode, series, selectedIds]);

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

  const setPoolLightDarkAndRefresh = (next: boolean) => {
    setPoolLightDark(next);
    bumpPlot();
  };

  const setDifferenceAndRefresh = (next: boolean) => {
    setShowDifference(next);
    bumpPlot();
  };

  const setCumulativeDifferenceAndRefresh = (next: boolean) => {
    setShowCumulativeDifference(next);
    bumpPlot();
  };

  const canShowDifference =
    !isScatterView && visibleSeries.length === 2;

  useEffect(() => {
    if (!canShowDifference && showCumulativeDifference) {
      setShowCumulativeDifference(false);
    }
  }, [canShowDifference, showCumulativeDifference]);

  const handleTrialUpdated = useCallback((updated: TrialMeta) => {
    startTransition(() => {
      setTrials((prev) =>
        sortTrials(prev.map((t) => (t.id === updated.id ? updated : t))),
      );
      setSeries((prev) =>
        prev.map((s) => (s.meta.id === updated.id ? { ...s, meta: updated } : s)),
      );
    });
  }, []);

  const plotHeight = isNarrow
    ? (view === "combined" ? 720 : 380) +
      (showCumulativeDifference && canShowDifference
        ? metrics.length * 160
        : 0)
    : (view === "combined" ? 1000 : 520) +
      (showCumulativeDifference && canShowDifference
        ? metrics.length * 220
        : 0);

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-4 sm:py-6 lg:flex-row lg:items-start xl:px-6">
      <aside
        className="relative flex w-full shrink-0 flex-col rounded-lg border border-border bg-panel-elevated p-3 lg:w-auto"
        style={{
          width: isNarrow ? "100%" : panelWidth,
          height: isNarrow ? Math.min(panelHeight, 260) : panelHeight,
        }}
      >
        <h2 className="mb-3 shrink-0 text-sm font-semibold text-foreground">Trials</h2>
        <TrialSelector
          trials={trials}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize width"
          className="absolute inset-y-2 -right-1.5 hidden w-3 cursor-col-resize lg:block"
          onPointerDown={(e) => startPanelDrag("width", e)}
          onPointerMove={onPanelDrag}
          onPointerUp={endPanelDrag}
          onPointerCancel={endPanelDrag}
        />
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize height"
          className="absolute inset-x-2 -bottom-1.5 hidden h-3 cursor-row-resize lg:block"
          onPointerDown={(e) => startPanelDrag("height", e)}
          onPointerMove={onPanelDrag}
          onPointerUp={endPanelDrag}
          onPointerCancel={endPanelDrag}
        />
        <div
          role="separator"
          title="Drag to resize"
          className="absolute -bottom-1.5 -right-1.5 hidden h-4 w-4 cursor-nwse-resize lg:block"
          onPointerDown={(e) => startPanelDrag("both", e)}
          onPointerMove={onPanelDrag}
          onPointerUp={endPanelDrag}
          onPointerCancel={endPanelDrag}
        />
      </aside>

      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex max-w-full flex-wrap rounded border border-border p-0.5">
            {(
              [
                ["combined", "Combined"],
                ["ah", "AH"],
                ["rh", "RH"],
                ["temp", "Temp"],
                ["ahRate", "dAH/dt"],
                ["vpd", "VPD"],
                ["normRate", "Norm Rate"],
                ["ahRateVsVpd", "dAH/dt vs VPD"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setViewAndRefresh(k)}
                className={`rounded px-2 py-1.5 text-[11px] sm:px-3 sm:text-xs ${
                  view === k
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!isScatterView ? (
          <div className="flex rounded border border-border p-0.5">
            <button
              type="button"
              onClick={() => setModeAndRefresh("calendar")}
              className={`rounded px-3 py-1.5 text-xs ${
                mode === "calendar"
                  ? "bg-surface-hover text-foreground"
                  : "text-muted hover:text-foreground"
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
                  ? "bg-surface-hover text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Session start
            </button>
            <button
              type="button"
              onClick={() => setModeAndRefresh("trough")}
              disabled={!troughReady && series.length > 0}
              title={
                troughReady
                  ? "Align by AH trough (t_start)"
                  : "AH trough not detected for all selected trials"
              }
              className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "trough"
                  ? "bg-surface-hover text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              AH trough
            </button>
          </div>
          ) : null}

          {!isScatterView ? (
          <ToggleGroup
            labelOn="Fit on"
            labelOff="Fit off"
            on={showSmooth}
            onChange={setSmoothAndRefresh}
            title="Toggle LOWESS smooth fit curves"
          />
          ) : null}

          {!isScatterView ? (
          <ToggleGroup
            labelOn="Bookmarks on"
            labelOff="Bookmarks off"
            on={showBookmarks}
            onChange={setBookmarksAndRefresh}
            title="Toggle time bookmark markers"
          />
          ) : null}

          {!isScatterView ? (
            <div
              className="flex rounded border border-border p-0.5"
              title={
                canShowDifference
                  ? "Plot Δ = first selected trial − second, on the current x-axis (clock or aligned) and metric(s)"
                  : "Select exactly two trials to enable difference plot"
              }
            >
              <button
                type="button"
                disabled={!canShowDifference}
                onClick={() => setDifferenceAndRefresh(true)}
                className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                  showDifference && canShowDifference
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Diff on
              </button>
              <button
                type="button"
                disabled={!canShowDifference}
                onClick={() => setDifferenceAndRefresh(false)}
                className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                  !showDifference || !canShowDifference
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Diff off
              </button>
            </div>
          ) : null}

          {!isScatterView ? (
            <div
              className="flex rounded border border-border p-0.5"
              title={
                canShowDifference
                  ? "Cumulative evaporation difference: running sum of Δ over the overlapping time range"
                  : "Select exactly two trials to enable cumulative difference plot"
              }
            >
              <button
                type="button"
                disabled={!canShowDifference}
                onClick={() => setCumulativeDifferenceAndRefresh(true)}
                className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                  showCumulativeDifference && canShowDifference
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Cum Δ on
              </button>
              <button
                type="button"
                disabled={!canShowDifference}
                onClick={() => setCumulativeDifferenceAndRefresh(false)}
                className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                  !showCumulativeDifference || !canShowDifference
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Cum Δ off
              </button>
            </div>
          ) : null}

          {isScatterView ? (
          <ToggleGroup
            labelOn="Pool Light/Dark"
            labelOff="Per trial"
            on={poolLightDark}
            onChange={setPoolLightDarkAndRefresh}
            title="Pool post-turnaround points by chamber (ch1/ch2) and Light vs Dark plot labels into two clouds with trendlines"
          />
          ) : null}

          <ToggleGroup
            labelOn="Full res"
            labelOff="Sampled"
            on={fullResolution}
            onChange={setFullResolutionAndRefresh}
            title={resolutionToggleTitle(fullResolution)}
          />

          {loading || plotBusy ? (
            <span className="flex items-center gap-2 text-xs text-faint">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-steel border-t-transparent" />
              {loading ? "Loading data…" : "Updating plot…"}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="rounded border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-sm text-coral">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <div className="min-w-0 space-y-4">
            <div
              className={`relative ${loading || plotBusy ? "pointer-events-none" : ""}`}
            >
              {(loading || plotBusy) && visibleSeries.length > 0 ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-panel/70 backdrop-blur-[1px]">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-steel border-t-transparent" />
                    Loading plot…
                  </span>
                </div>
              ) : null}

              {visibleSeries.length > 0 ? (
                isScatterView ? (
                  <EvapRateVsVpdPlot
                    series={visibleSeries}
                    height={plotHeight}
                    plotRevision={plotRevision}
                    fullResolution={fullResolution}
                    poolLightDark={poolLightDark}
                  />
                ) : (
                  <SensorPlot
                    series={visibleSeries}
                    mode={mode}
                    metrics={metrics}
                    height={plotHeight}
                    plotRevision={plotRevision}
                    showSmooth={showSmooth}
                    showBookmarks={showBookmarks}
                    fullResolution={fullResolution}
                    showDifference={showDifference && canShowDifference}
                    showCumulativeDifference={
                      showCumulativeDifference && canShowDifference
                    }
                    onTimePick={({ trialId, time }) => {
                      setBookmarkPrefill({
                        trialId,
                        time,
                        nonce: Date.now(),
                      });
                    }}
                  />
                )
              ) : (
                <div className="flex h-[520px] items-center justify-center rounded-lg border border-border bg-panel text-muted">
                  {isElapsedPlotMode(mode) && series.length > 0 && !isScatterView
                    ? mode === "trough"
                      ? "Selected trials need a detectable AH trough (check session starts / early AH data)."
                      : "Selected trials need session start times (set them on Dashboard)."
                    : "Select one or more trials to plot."}
                </div>
              )}
            </div>

            {visibleSeries.length > 0 && !isScatterView ? (
              <PlotBookmarkAdd
                series={visibleSeries}
                prefill={bookmarkPrefill}
                onSaved={handleTrialUpdated}
              />
            ) : null}

            <NormRateStatsTable />
          </div>

          {visibleSeries.length > 0 ? (
            <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
              <PlotTrialNotes series={visibleSeries} onSaved={handleTrialUpdated} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
