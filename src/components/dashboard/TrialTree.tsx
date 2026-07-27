"use client";

import { useMemo, useState } from "react";
import { TrialMetadataForm } from "@/components/dashboard/TrialMetadataForm";
import { groupTrialsByDayRun } from "@/lib/trial-sort";
import type { TrialMeta } from "@/types/trial";

type Props = {
  trials: TrialMeta[];
  onSaved: (t: TrialMeta) => void;
  onDeleted: (id: string) => void;
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

export function TrialTree({ trials, onSaved, onDeleted }: Props) {
  const grouped = useMemo(() => groupTrialsByDayRun(trials), [trials]);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const [openTrials, setOpenTrials] = useState<Set<string>>(new Set());

  const toggleDay = (day: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const toggleRun = (key: string) => {
    setOpenRuns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTrial = (id: string) => {
    setOpenTrials((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (trials.length === 0) {
    return <p className="text-sm text-[#8a8a8d]">No trials uploaded yet.</p>;
  }

  return (
    <div className="space-y-2">
      {grouped.map(({ day, runs }) => {
        const dayOpen = openDays.has(day);
        const trialCount = runs.reduce((n, r) => n + r.items.length, 0);
        return (
          <div
            key={day}
            className="overflow-hidden rounded-lg border border-[#3a3b3f] bg-[#16171a]"
          >
            <button
              type="button"
              onClick={() => toggleDay(day)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[#1e1f22]"
            >
              <Chevron open={dayOpen} />
              <span className="flex-1 text-sm font-medium text-white">{day}</span>
              <span className="text-xs text-[#8a8a8d]">
                {runs.length} run{runs.length === 1 ? "" : "s"} · {trialCount} file
                {trialCount === 1 ? "" : "s"}
              </span>
            </button>

            {dayOpen ? (
              <div className="border-t border-[#3a3b3f] px-2 pb-2 pt-1">
                {runs.map(({ run, items }) => {
                  const runKey = `${day}::${run}`;
                  const runOpen = openRuns.has(runKey);
                  return (
                    <div key={runKey} className="ml-2 mt-1">
                      <button
                        type="button"
                        onClick={() => toggleRun(runKey)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[#1e1f22]"
                      >
                        <Chevron open={runOpen} />
                        <span className="text-sm text-[#e8e8e8]">{run}</span>
                        <span className="text-xs text-[#8a8a8d]">
                          {items.length} file{items.length === 1 ? "" : "s"}
                        </span>
                      </button>

                      {runOpen ? (
                        <div className="ml-4 space-y-1 border-l border-[#3a3b3f] pl-2">
                          {items.map((trial) => {
                            const trialOpen = openTrials.has(trial.id);
                            return (
                              <div key={trial.id}>
                                <button
                                  type="button"
                                  onClick={() => toggleTrial(trial.id)}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[#1e1f22]"
                                >
                                  <Chevron open={trialOpen} />
                                  <span className="truncate text-sm text-[#e8e8e8]">
                                    {trial.label}
                                  </span>
                                  <span className="truncate text-xs text-[#8a8a8d]">
                                    {trial.filename}
                                  </span>
                                </button>
                                {trialOpen ? (
                                  <div className="mb-2 ml-4 mt-1">
                                    <TrialMetadataForm
                                      trial={trial}
                                      onSaved={onSaved}
                                      onDeleted={onDeleted}
                                    />
                                  </div>
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
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
