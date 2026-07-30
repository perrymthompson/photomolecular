"use client";

import { useMemo, useState } from "react";
import { groupTrialsByDayRun, sortTrials } from "@/lib/trial-sort";
import type { TrialMeta } from "@/types/trial";

type Props = {
  trials: TrialMeta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

/** Add new filter keys here as needed (day, run, hardware, …). */
type TrialFilterKey = "chamber" | "plotLabel";

type TrialFilterDef = {
  key: TrialFilterKey;
  title: string;
  /** Empty / missing value shown in the option list. */
  emptyLabel: string;
  getValue: (t: TrialMeta) => string;
};

const TRIAL_FILTERS: TrialFilterDef[] = [
  {
    key: "chamber",
    title: "Chamber",
    emptyLabel: "(none)",
    getValue: (t) => t.label?.trim() || "",
  },
  {
    key: "plotLabel",
    title: "Label",
    emptyLabel: "(no label)",
    getValue: (t) => t.plotLabel?.trim() || "",
  },
];

type ActiveFilters = Partial<Record<TrialFilterKey, string[]>>;

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

function uniqueSortedValues(
  trials: TrialMeta[],
  getValue: (t: TrialMeta) => string,
): string[] {
  const set = new Set(trials.map(getValue));
  return [...set].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

function matchesFilters(t: TrialMeta, filters: ActiveFilters): boolean {
  for (const def of TRIAL_FILTERS) {
    const selected = filters[def.key];
    if (!selected?.length) continue;
    if (!selected.includes(def.getValue(t))) return false;
  }
  return true;
}

function FilterChipRow({
  def,
  options,
  selected,
  onChange,
}: {
  def: TrialFilterDef;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  if (options.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8a8d]">
          {def.title}
        </span>
        {selected.length > 0 ? (
          <button
            type="button"
            className="text-[10px] text-[#8a8a8d] hover:text-white"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map((value) => {
          const on = selected.includes(value);
          const label = value || def.emptyLabel;
          return (
            <button
              key={`${def.key}:${value || "__empty"}`}
              type="button"
              title={label}
              onClick={() => toggle(value)}
              className={`max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] ${
                on
                  ? "border-[#4C8FD1] bg-[#4C8FD1]/20 text-white"
                  : "border-[#3a3b3f] text-[#b5b5b8] hover:border-[#5c5d61] hover:text-white"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TrialSelector({ trials, selectedIds, onChange }: Props) {
  const sorted = useMemo(() => sortTrials(trials), [trials]);
  const [filters, setFilters] = useState<ActiveFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => sorted.filter((t) => matchesFilters(t, filters)),
    [sorted, filters],
  );
  const grouped = useMemo(() => groupTrialsByDayRun(filtered), [filtered]);

  const filterOptions = useMemo(() => {
    const map = {} as Record<TrialFilterKey, string[]>;
    for (const def of TRIAL_FILTERS) {
      map[def.key] = uniqueSortedValues(sorted, def.getValue);
    }
    return map;
  }, [sorted]);

  const activeFilterCount = TRIAL_FILTERS.reduce(
    (n, def) => n + (filters[def.key]?.length ? 1 : 0),
    0,
  );

  const setFilterValues = (key: TrialFilterKey, values: string[]) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (!values.length) delete next[key];
      else next[key] = values;
      return next;
    });
  };

  const clearFilters = () => setFilters({});

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
          onClick={() => onChange(filtered.map((t) => t.id))}
          title="Select all trials currently visible under filters"
        >
          Select visible
        </button>
        <button
          type="button"
          className="rounded border border-[#3a3b3f] px-2 py-1 text-xs text-[#e8e8e8] hover:bg-[#2a2b2e]"
          onClick={() => onChange([])}
        >
          Clear
        </button>
        <button
          type="button"
          className={`rounded border px-2 py-1 text-xs ${
            filtersOpen || activeFilterCount > 0
              ? "border-[#4C8FD1] text-[#4C8FD1]"
              : "border-[#3a3b3f] text-[#e8e8e8] hover:bg-[#2a2b2e]"
          }`}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {filtersOpen ? (
        <div className="shrink-0 space-y-2 rounded border border-[#3a3b3f] bg-[#1e1f22] p-2">
          {TRIAL_FILTERS.map((def) => (
            <FilterChipRow
              key={def.key}
              def={def}
              options={filterOptions[def.key]}
              selected={filters[def.key] ?? []}
              onChange={(next) => setFilterValues(def.key, next)}
            />
          ))}
          {activeFilterCount > 0 ? (
            <button
              type="button"
              className="text-[10px] text-[#8a8a8d] hover:text-white"
              onClick={clearFilters}
            >
              Clear all filters
            </button>
          ) : null}
          <p className="text-[10px] text-[#6d6d70]">
            Showing {filtered.length} of {sorted.length}
          </p>
        </div>
      ) : null}

      <div className="scrollbar-themed min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {grouped.length === 0 ? (
          <p className="px-1 text-xs text-[#8a8a8d]">
            No trials match the current filters.
          </p>
        ) : null}

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
