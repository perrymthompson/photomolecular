"use client";

import { useEffect, useState } from "react";
import { CsvUploader } from "@/components/dashboard/CsvUploader";
import { TrialTree } from "@/components/dashboard/TrialTree";
import { sortTrials } from "@/lib/trial-sort";
import type { TrialMeta } from "@/types/trial";

export function DashboardClient() {
  const [trials, setTrials] = useState<TrialMeta[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/trials");
      const data = (await res.json()) as TrialMeta[] | { error?: string };
      if (!res.ok || !Array.isArray(data)) {
        throw new Error(
          typeof data === "object" && data && "error" in data
            ? (data.error ?? "Failed to load trials")
            : "Failed to load trials",
        );
      }
      setTrials(sortTrials(data));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load trials");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const existingFilenames = trials.map((t) => t.filename);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Trial dashboard</h1>
        <p className="mt-1 text-sm text-[#b5b5b8]">
          Upload CSVs and edit notes / session start times — the same metadata
          your R script collected via popups, editable anytime online.
        </p>
      </div>

      <CsvUploader
        existingFilenames={existingFilenames}
        onUploaded={(added) => {
          setTrials((prev) => {
            const map = new Map(prev.map((t) => [t.id, t]));
            for (const t of added) map.set(t.id, t);
            return sortTrials([...map.values()]);
          });
        }}
      />

      {loadError ? (
        <p className="rounded border border-[#E2574C]/40 bg-[#E2574C]/10 px-3 py-2 text-sm text-[#E2574C]">
          {loadError}
        </p>
      ) : null}

      <TrialTree
        trials={trials}
        onSaved={(updated) =>
          setTrials((prev) =>
            sortTrials(prev.map((x) => (x.id === updated.id ? updated : x))),
          )
        }
        onDeleted={(id) => setTrials((prev) => prev.filter((x) => x.id !== id))}
      />
    </div>
  );
}
