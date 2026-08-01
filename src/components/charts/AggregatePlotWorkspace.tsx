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
import { PlotTrialNotes } from "@/components/charts/PlotTrialNotes";
import { TrialSelector } from "@/components/charts/TrialSelector";
import { detectAhTurnaround } from "@/lib/derived-metrics";
import { sessionStartIso } from "@/lib/parse-csv";
import { sortTrials } from "@/lib/trial-sort";
import type { MetricKey, PlotMode, TrialMeta, TrialSeries } from "@/types/trial";
import { isElapsedPlotMode } from "@/types/trial";

const STORAGE_KEY = "aggregate-plot-workspace-v1";
const PANEL_SIZE_KEY = "aggregate-trials-panel-size-v1";
const PANEL_DEFAULT = { width: 300, height: 520 };
const PANEL_MIN = { width: 220, height: 280 };
const PANEL_MAX = { width: 560, height: 960 };

type PlotView =
  | "combined"
  | "ah"
  | "rh"
  | "temp"
  | "ahRate"
  | "vpd"
  | "normRate";

type ActiveSet = "A" | "B";

type PersistedState = {
  idsA?: string[];
  idsB?: string[];
  mode?: PlotMode;
  view?: PlotView;
  showSmooth?: boolean;
  fullResolution?: boolean;
  modeTouched?: boolean;
  labelA?: string;
  labelB?: string;
};

const AggregateSensorPlot = dynamic(
  () =>
    import("@/components/charts/AggregateSensorPlot").then(
      (mod) => mod.AggregateSensorPlot,
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
    return "Full res: every CSV row (default for aggregate). Gaps >10s honored for derived metrics.";
  }
  return "Sampled mode: ~1800 evenly spaced points per trial for speed.";
}

function seedLightDarkIds(trials: TrialMeta[]): {
  idsA: string[];
  idsB: string[];
} {
  const light: string[] = [];
  const dark: string[] = [];
  for (const t of trials) {
    const label = (t.plotLabel ?? "").toLowerCase();
    if (label.includes("light")) light.push(t.id);
    else if (label.includes("dark")) dark.push(t.id);
  }
  return { idsA: light, idsB: dark };
}

export function AggregatePlotWorkspace() {
  const [trials, setTrials] = useState<TrialMeta[]>([]);
  const [idsA, setIdsA] = useState<string[]>([]);
  const [idsB, setIdsB] = useState<string[]>([]);
  const [activeSet, setActiveSet] = useState<ActiveSet>("A");
  const [labelA, setLabelA] = useState("Set A");
  const [labelB, setLabelB] = useState("Set B");
  const [seriesById, setSeriesById] = useState<Record<string, TrialSeries>>(
    {},
  );
  const [mode, setMode] = useState<PlotMode>("aligned");
  const [view, setView] = useState<PlotView>("ah");
  const [showSmooth, setShowSmooth] = useState(true);
  const [fullResolution, setFullResolution] = useState(true);
  const [showDifference, setShowDifference] = useState(false);
  const [showCumulativeDifference, setShowCumulativeDifference] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [plotBusy, setPlotBusy] = useState(false);
  const [plotRevision, setPlotRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modeTouched, setModeTouched] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT.width);
  const [panelHeight, setPanelHeight] = useState(PANEL_DEFAULT.height);

  const restoredRef = useRef<{ idsA: string[]; idsB: string[] } | null>(null);
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
      const raw = window.localStorage.getItem(PANEL_SIZE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { width?: number; height?: number };
      if (typeof parsed.width === "number") {
        setPanelWidth(
          Math.min(PANEL_MAX.width, Math.max(PANEL_MIN.width, parsed.width)),
        );
      }
      if (typeof parsed.height === "number") {
        setPanelHeight(
          Math.min(PANEL_MAX.height, Math.max(PANEL_MIN.height, parsed.height)),
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PANEL_SIZE_KEY,
        JSON.stringify({ width: panelWidth, height: panelHeight }),
      );
    } catch {
      // ignore
    }
  }, [panelWidth, panelHeight]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
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
        parsed.view === "normRate"
      ) {
        setView(parsed.view);
      }
      if (typeof parsed.showSmooth === "boolean") setShowSmooth(parsed.showSmooth);
      if (typeof parsed.fullResolution === "boolean") {
        setFullResolution(parsed.fullResolution);
      }
      if (typeof parsed.modeTouched === "boolean") {
        setModeTouched(parsed.modeTouched);
      } else if (parsed.mode) {
        setModeTouched(true);
      }
      if (typeof parsed.labelA === "string" && parsed.labelA.trim()) {
        setLabelA(parsed.labelA.trim());
      }
      if (typeof parsed.labelB === "string" && parsed.labelB.trim()) {
        setLabelB(parsed.labelB.trim());
      }
      if (Array.isArray(parsed.idsA) || Array.isArray(parsed.idsB)) {
        restoredRef.current = {
          idsA: Array.isArray(parsed.idsA) ? parsed.idsA : [],
          idsB: Array.isArray(parsed.idsB) ? parsed.idsB : [],
        };
      }
    } catch {
      // ignore
    } finally {
      storageReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!storageReadyRef.current) return;
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }
    const next: PersistedState = {
      idsA,
      idsB,
      mode,
      view,
      showSmooth,
      fullResolution,
      modeTouched,
      labelA,
      labelB,
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, [
    idsA,
    idsB,
    mode,
    view,
    showSmooth,
    fullResolution,
    modeTouched,
    labelA,
    labelB,
  ]);

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
        if (!data.length) return;
        const valid = new Set(data.map((t) => t.id));
        const restored = restoredRef.current;
        if (restored && (restored.idsA.length || restored.idsB.length)) {
          setIdsA(restored.idsA.filter((id) => valid.has(id)));
          setIdsB(restored.idsB.filter((id) => valid.has(id)));
          return;
        }
        const seeded = seedLightDarkIds(data);
        if (seeded.idsA.length || seeded.idsB.length) {
          setIdsA(seeded.idsA);
          setIdsB(seeded.idsB);
          if (seeded.idsA.length) setLabelA("Light");
          if (seeded.idsB.length) setLabelB("Dark");
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const allSelectedIds = useMemo(() => {
    const set = new Set([...idsA, ...idsB]);
    return [...set];
  }, [idsA, idsB]);

  const loadSeries = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setSeriesById({});
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
      const next: Record<string, TrialSeries> = {};
      for (const s of loaded) next[s.meta.id] = s;
      setSeriesById(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load series");
    } finally {
      setLoading(false);
      setPlotBusy(false);
      setPlotRevision((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    void loadSeries(allSelectedIds);
  }, [allSelectedIds, loadSeries]);

  const seriesA = useMemo(
    () =>
      idsA
        .map((id) => seriesById[id])
        .filter((s): s is TrialSeries => Boolean(s)),
    [idsA, seriesById],
  );
  const seriesB = useMemo(
    () =>
      idsB
        .map((id) => seriesById[id])
        .filter((s): s is TrialSeries => Boolean(s)),
    [idsB, seriesById],
  );

  const notesSeries = useMemo(() => {
    const seen = new Set<string>();
    const out: TrialSeries[] = [];
    for (const s of [...seriesA, ...seriesB]) {
      if (seen.has(s.meta.id)) continue;
      seen.add(s.meta.id);
      out.push(s);
    }
    return out;
  }, [seriesA, seriesB]);

  const filterForMode = useCallback(
    (list: TrialSeries[]) => {
      if (mode === "calendar") return list;
      if (mode === "aligned") {
        return list.filter((s) => s.meta.sessionStartTime);
      }
      return list.filter((s) => {
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
    },
    [mode],
  );

  const visibleA = useMemo(
    () => filterForMode(seriesA),
    [filterForMode, seriesA],
  );
  const visibleB = useMemo(
    () => filterForMode(seriesB),
    [filterForMode, seriesB],
  );

  const loadedSeries = useMemo(
    () => [...seriesA, ...seriesB],
    [seriesA, seriesB],
  );

  const alignedReady =
    loadedSeries.length > 0 &&
    loadedSeries.every((s) => s.meta.sessionStartTime);
  const troughReady = useMemo(() => {
    if (loadedSeries.length === 0) return false;
    return loadedSeries.every((s) => {
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
  }, [loadedSeries]);

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
                : ["normRate"];

  const canShowDifference = visibleA.length > 0 && visibleB.length > 0;

  useEffect(() => {
    if (!canShowDifference && showDifference) setShowDifference(false);
    if (!canShowDifference && showCumulativeDifference) {
      setShowCumulativeDifference(false);
    }
  }, [canShowDifference, showDifference, showCumulativeDifference]);

  const bumpPlot = () => {
    setPlotBusy(true);
    setPlotRevision((n) => n + 1);
    window.setTimeout(() => setPlotBusy(false), 350);
  };

  const setViewAndRefresh = (next: PlotView) => {
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
  const setFullResolutionAndRefresh = (next: boolean) => {
    setFullResolution(next);
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

  const handleTrialUpdated = useCallback((updated: TrialMeta) => {
    startTransition(() => {
      setTrials((prev) =>
        sortTrials(prev.map((t) => (t.id === updated.id ? updated : t))),
      );
      setSeriesById((prev) => {
        const existing = prev[updated.id];
        if (!existing) return prev;
        return {
          ...prev,
          [updated.id]: { ...existing, meta: updated },
        };
      });
    });
  }, []);

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
        Math.min(PANEL_MAX.width, Math.max(PANEL_MIN.width, next)),
      );
    }
    if (drag.kind === "height" || drag.kind === "both") {
      const next = drag.startH + (e.clientY - drag.startY);
      setPanelHeight(
        Math.min(PANEL_MAX.height, Math.max(PANEL_MIN.height, next)),
      );
    }
  };

  const endPanelDrag = () => {
    dragRef.current = null;
  };

  const activeIds = activeSet === "A" ? idsA : idsB;
  const setActiveIds = activeSet === "A" ? setIdsA : setIdsB;

  const overlapCount = useMemo(() => {
    const b = new Set(idsB);
    return idsA.filter((id) => b.has(id)).length;
  }, [idsA, idsB]);

  const plotHeight =
    (view === "combined" ? 1000 : 520) +
    (showCumulativeDifference && canShowDifference
      ? metrics.length * 220
      : 0);

  const hasPlot = visibleA.length > 0 || visibleB.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start xl:px-6">
      <aside
        className="relative flex shrink-0 flex-col rounded-lg border border-[#3a3b3f] bg-[#16171a] p-3"
        style={{ width: panelWidth, height: panelHeight }}
      >
        <h2 className="mb-2 shrink-0 text-sm font-semibold text-white">
          Aggregate sets
        </h2>

        <div className="mb-2 flex shrink-0 rounded border border-[#3a3b3f] p-0.5">
          <button
            type="button"
            onClick={() => setActiveSet("A")}
            className={`flex-1 rounded px-2 py-1.5 text-xs ${
              activeSet === "A"
                ? "bg-[#4C8FD1]/25 text-white"
                : "text-[#b5b5b8] hover:text-white"
            }`}
          >
            {labelA}{" "}
            <span className="text-[#8a8a8d]">({idsA.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSet("B")}
            className={`flex-1 rounded px-2 py-1.5 text-xs ${
              activeSet === "B"
                ? "bg-[#E2574C]/25 text-white"
                : "text-[#b5b5b8] hover:text-white"
            }`}
          >
            {labelB}{" "}
            <span className="text-[#8a8a8d]">({idsB.length})</span>
          </button>
        </div>

        <div className="mb-2 shrink-0">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-[#8a8a8d]">
            {activeSet === "A" ? "Set A name" : "Set B name"}
          </label>
          <input
            type="text"
            value={activeSet === "A" ? labelA : labelB}
            onChange={(e) => {
              const v = e.target.value;
              if (activeSet === "A") setLabelA(v || "Set A");
              else setLabelB(v || "Set B");
            }}
            className="w-full rounded border border-[#3a3b3f] bg-[#1e1f22] px-2 py-1 text-xs text-[#e8e8e8]"
          />
        </div>

        {overlapCount > 0 ? (
          <p className="mb-2 shrink-0 text-[10px] text-[#F0AD4E]">
            {overlapCount} trial{overlapCount === 1 ? "" : "s"} in both sets
          </p>
        ) : null}

        <TrialSelector
          trials={trials}
          selectedIds={activeIds}
          onChange={setActiveIds}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize width"
          className="absolute inset-y-2 -right-1.5 w-3 cursor-col-resize"
          onPointerDown={(e) => startPanelDrag("width", e)}
          onPointerMove={onPanelDrag}
          onPointerUp={endPanelDrag}
          onPointerCancel={endPanelDrag}
        />
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize height"
          className="absolute inset-x-2 -bottom-1.5 h-3 cursor-row-resize"
          onPointerDown={(e) => startPanelDrag("height", e)}
          onPointerMove={onPanelDrag}
          onPointerUp={endPanelDrag}
          onPointerCancel={endPanelDrag}
        />
        <div
          role="separator"
          title="Drag to resize"
          className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize"
          onPointerDown={(e) => startPanelDrag("both", e)}
          onPointerMove={onPanelDrag}
          onPointerUp={endPanelDrag}
          onPointerCancel={endPanelDrag}
        />
      </aside>

      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap rounded border border-[#3a3b3f] p-0.5">
            {(
              [
                ["combined", "Combined"],
                ["ah", "AH"],
                ["rh", "RH"],
                ["temp", "Temp"],
                ["ahRate", "dAH/dt"],
                ["vpd", "VPD"],
                ["normRate", "Norm Rate"],
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
              title="Wall-clock time (best when trials share the same day)"
            >
              Clock time
            </button>
            <button
              type="button"
              onClick={() => setModeAndRefresh("aligned")}
              disabled={!alignedReady && allSelectedIds.length > 0}
              title={
                alignedReady
                  ? "Align by session start (recommended for aggregate)"
                  : "Set session start times in Dashboard first"
              }
              className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "aligned"
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
              }`}
            >
              Session start
            </button>
            <button
              type="button"
              onClick={() => setModeAndRefresh("trough")}
              disabled={!troughReady && allSelectedIds.length > 0}
              title={
                troughReady
                  ? "Align by AH trough (t_start)"
                  : "AH trough not detected for all selected trials"
              }
              className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === "trough"
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
              }`}
            >
              AH trough
            </button>
          </div>

          <ToggleGroup
            labelOn="Fit on"
            labelOff="Fit off"
            on={showSmooth}
            onChange={setSmoothAndRefresh}
            title="Fit off = pooled scatter; Fit on = LOESS best-fit on each set"
          />

          <div
            className="flex rounded border border-[#3a3b3f] p-0.5"
            title={
              canShowDifference
                ? `Δ = ${labelA} fit − ${labelB} fit on shared x`
                : "Select at least one trial in each set"
            }
          >
            <button
              type="button"
              disabled={!canShowDifference}
              onClick={() => setDifferenceAndRefresh(true)}
              className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                showDifference && canShowDifference
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
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
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
              }`}
            >
              Diff off
            </button>
          </div>

          <div
            className="flex rounded border border-[#3a3b3f] p-0.5"
            title={
              canShowDifference
                ? "Running sum of Δ over the overlapping range"
                : "Select at least one trial in each set"
            }
          >
            <button
              type="button"
              disabled={!canShowDifference}
              onClick={() => setCumulativeDifferenceAndRefresh(true)}
              className={`rounded px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                showCumulativeDifference && canShowDifference
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
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
                  ? "bg-[#2a2b2e] text-white"
                  : "text-[#b5b5b8] hover:text-white"
              }`}
            >
              Cum Δ off
            </button>
          </div>

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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <div className="min-w-0 space-y-4">
            <div
              className={`relative ${loading || plotBusy ? "pointer-events-none" : ""}`}
            >
              {(loading || plotBusy) && hasPlot ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#1e1f22]/70 backdrop-blur-[1px]">
                  <span className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#4C8FD1] border-t-transparent" />
                    Loading plot…
                  </span>
                </div>
              ) : null}

              {hasPlot ? (
                <AggregateSensorPlot
                  seriesA={visibleA}
                  seriesB={visibleB}
                  labelA={labelA}
                  labelB={labelB}
                  mode={mode}
                  metrics={metrics}
                  height={plotHeight}
                  plotRevision={plotRevision}
                  showSmooth={showSmooth}
                  fullResolution={fullResolution}
                  showDifference={showDifference && canShowDifference}
                  showCumulativeDifference={
                    showCumulativeDifference && canShowDifference
                  }
                />
              ) : (
                <div className="flex h-[520px] items-center justify-center rounded-lg border border-[#3a3b3f] bg-[#1e1f22] text-[#b5b5b8]">
                  {isElapsedPlotMode(mode) && allSelectedIds.length > 0
                    ? mode === "trough"
                      ? "Selected trials need a detectable AH trough (check session starts / early AH data)."
                      : "Selected trials need session start times (set them on Dashboard)."
                    : "Select trials into Set A and/or Set B to plot."}
                </div>
              )}
            </div>
          </div>

          {notesSeries.length > 0 ? (
            <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
              <PlotTrialNotes
                series={notesSeries}
                onSaved={handleTrialUpdated}
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
