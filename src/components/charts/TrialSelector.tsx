"use client";

import type { TrialMeta } from "@/types/trial";

type Props = {
  trials: TrialMeta[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function TrialSelector({ trials, selectedIds, onChange }: Props) {
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

  // Group by date label for easier day comparison
  const groups = new Map<string, TrialMeta[]>();
  for (const t of trials) {
    const key = t.dateLabel ?? "Unknown date";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-[#3a3b3f] px-2 py-1 text-xs text-[#e8e8e8] hover:bg-[#2a2b2e]"
          onClick={() => onChange(trials.map((t) => t.id))}
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
      {[...groups.entries()].map(([date, items]) => (
        <div key={date}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#8a8a8d]">
            {date}
          </h3>
          <ul className="space-y-1">
            {items.map((t) => {
              const checked = selectedIds.includes(t.id);
              return (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-[#2a2b2e]">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={() => toggle(t.id)}
                    />
                    <span>
                      <span className="block text-sm font-medium text-[#e8e8e8]">
                        {t.label}{" "}
                        <span className="font-normal text-[#8a8a8d]">
                          ({t.filename})
                        </span>
                      </span>
                      {t.notes ? (
                        <span className="block text-xs text-[#b5b5b8]">
                          {t.notes}
                        </span>
                      ) : null}
                      {t.sessionStartTime ? (
                        <span className="block text-xs text-[#8a8a8d]">
                          Session start: {t.sessionStartTime}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
