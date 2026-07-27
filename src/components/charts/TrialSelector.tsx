"use client";

import { useMemo, useState } from "react";
import { groupTrialsByDayRun, sortTrials } from "@/lib/trial-sort";
import type { TrialMeta } from "@/types/trial";

const INITIAL_DAYS = 3;

type Props = {
  trials: TrialMeta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function TrialSelector({ trials, selectedIds, onChange }: Props) {
  const [expandedDays, setExpandedDays] = useState(INITIAL_DAYS);

  const sorted = useMemo(() => sortTrials(trials), [trials]);
  const grouped = useMemo(() => groupTrialsByDayRun(sorted), [sorted]);
  const visibleGroups = grouped.slice(0, expandedDays);
  const hiddenCount = grouped.length - visibleGroups.length;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
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

      <div className="max-h-[min(52vh,420px)] space-y-3 overflow-y-auto pr-1">
        {visibleGroups.map(({ day, runs }) => (
          <div key={day}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#8a8a8d]">
              {day}
            </h3>
            <div className="space-y-2 pl-1">
              {runs.map(({ run, items }) => (
                <div key={`${day}-${run}`}>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[#6d6d70]">
                    {run}
                  </p>
                  <ul className="space-y-0.5">
                    {items.map((t) => {
                      const checked = selectedIds.includes(t.id);
                      return (
                        <li key={t.id}>
                          <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-[#2a2b2e]">
                            <input
                              type="checkbox"
                              className="mt-0.5 shrink-0"
                              checked={checked}
                              onChange={() => toggle(t.id)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-[#e8e8e8]">
                                {t.label}
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
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hiddenCount > 0 ? (
        <button
          type="button"
          className="w-full rounded border border-[#3a3b3f] px-2 py-1.5 text-xs text-[#b5b5b8] hover:bg-[#2a2b2e] hover:text-white"
          onClick={() => setExpandedDays((n) => n + 3)}
        >
          Load more days ({hiddenCount} older)
        </button>
      ) : null}
    </div>
  );
}
