"use client";

import { useMemo, useState } from "react";
import { groupTrialsByDayRun, sortTrials } from "@/lib/trial-sort";
import type { TrialMeta } from "@/types/trial";

type Props = {
  trials: TrialMeta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className={`inline-block text-[#8a8a8d] transition-transform ${open ? "rotate-90" : ""}`}
    >
      ▶
    </span>
  );
}

function selectionState(
  ids: string[],
  selectedIds: string[],
): "all" | "some" | "none" {
  const n = ids.filter((id) => selectedIds.includes(id)).length;
  if (n === 0) return "none";
  if (n === ids.length) return "all";
  return "some";
}

export function TrialSelector({ trials, selectedIds, onChange }: Props) {
  const sorted = useMemo(() => sortTrials(trials), [trials]);
  const grouped = useMemo(() => groupTrialsByDayRun(sorted), [sorted]);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());

  const toggleDay = (day: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const toggleRunOpen = (key: string) => {
    setOpenRuns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTrial = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const toggleRunSelection = (itemIds: string[]) => {
    const state = selectionState(itemIds, selectedIds);
    if (state === "all") {
      onChange(selectedIds.filter((id) => !itemIds.includes(id)));
    } else {
      const set = new Set(selectedIds);
      for (const id of itemIds) set.add(id);
      onChange([...set]);
    }
  };

  if (trials.length === 0) {
    return (
      <p className="text-sm text-[#b5b5b8]">
        No trials yet. Drop CSVs into <code className="text-[#e8e8e8]">data/csv/</code>{" "}
        or upload them on the Dashboard.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-[#3a3b3f] px-2 py-1 text-xs text-[#e8e8e8] hover:bg-[#2a2b2e]"
          onClick={() => onChange(sorted.map((t) => t.id))}
        >
          Select all
        </button>
        <button
          type="button"
          className="rounded border border-[#3a3b3f] px-2 py-1 text-xs text-[#e8e8e8] hover:bg-[#2a2b2e]"
          onClick={() => onChange([])}
        >
          Clear
        </button>
      </div>

      <div className="scrollbar-themed min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {grouped.map(({ day, runs }) => {
          const dayOpen = openDays.has(day);
          const dayIds = runs.flatMap((r) => r.items.map((t) => t.id));
          const trialCount = dayIds.length;

          return (
            <div
              key={day}
              className="overflow-hidden rounded-lg border border-[#3a3b3f] bg-[#1e1f22]"
            >
              <button
                type="button"
                onClick={() => toggleDay(day)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-[#25262a]"
              >
                <Chevron open={dayOpen} />
                <span className="flex-1 text-sm font-medium text-white">{day}</span>
                <span className="text-[10px] text-[#8a8a8d]">
                  {runs.length} run{runs.length === 1 ? "" : "s"} · {trialCount}
                </span>
              </button>

              {dayOpen ? (
                <div className="border-t border-[#3a3b3f] px-1.5 pb-2 pt-1">
                  {runs.map(({ run, items }) => {
                    const runKey = `${day}::${run}`;
                    const runOpen = openRuns.has(runKey);
                    const itemIds = items.map((t) => t.id);
                    const runSel = selectionState(itemIds, selectedIds);

                    return (
                      <div key={runKey} className="mt-1">
                        <div className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-[#25262a]">
                          <button
                            type="button"
                            onClick={() => toggleRunOpen(runKey)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <Chevron open={runOpen} />
                            <span className="text-sm text-[#e8e8e8]">{run}</span>
                            <span className="text-[10px] text-[#8a8a8d]">
                              {items.length}
                            </span>
                          </button>
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={runSel === "all"}
                            ref={(el) => {
                              if (el) el.indeterminate = runSel === "some";
                            }}
                            title={
                              runSel === "all"
                                ? "Uncheck all trials in this run"
                                : "Select all trials in this run"
                            }
                            onChange={() => toggleRunSelection(itemIds)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>

                        {runOpen ? (
                          <ul className="ml-3 space-y-0.5 border-l border-[#3a3b3f] pl-2">
                            {items.map((t) => {
                              const checked = selectedIds.includes(t.id);
                              const plotLabel = t.plotLabel?.trim();
                              return (
                                <li key={t.id}>
                                  <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-[#25262a]">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 shrink-0"
                                      checked={checked}
                                      onChange={() => toggleTrial(t.id)}
                                    />
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm text-[#e8e8e8]">
                                        <span className="font-medium">{t.label}</span>
                                        {plotLabel ? (
                                          <span className="text-[#b5b5b8]">
                                            {" "}
                                            · {plotLabel}
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="block truncate text-[10px] text-[#8a8a8d]">
                                        {t.filename}
                                      </span>
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
