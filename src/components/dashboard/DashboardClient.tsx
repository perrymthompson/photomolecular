"use client";

import { useEffect, useState } from "react";
import { CsvUploader } from "@/components/dashboard/CsvUploader";
import { TrialMetadataForm } from "@/components/dashboard/TrialMetadataForm";
import type { TrialMeta } from "@/types/trial";

export function DashboardClient() {
  const [trials, setTrials] = useState<TrialMeta[]>([]);

  const refresh = () =>
    fetch("/api/trials")
      .then((r) => r.json())
      .then((d: TrialMeta[]) => setTrials(d));

  useEffect(() => {
    void refresh();
  }, []);

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
        onUploaded={(added) =>
          setTrials((prev) => {
            const map = new Map(prev.map((t) => [t.id, t]));
            for (const t of added) map.set(t.id, t);
            return [...map.values()];
          })
        }
      />

      <div className="space-y-3">
        {trials.length === 0 ? (
          <p className="text-sm text-[#8a8a8d]">No trials uploaded yet.</p>
        ) : (
          trials.map((t) => (
            <TrialMetadataForm
              key={t.id}
              trial={t}
              onSaved={(updated) =>
                setTrials((prev) =>
                  prev.map((x) => (x.id === updated.id ? updated : x)),
                )
              }
              onDeleted={(id) =>
                setTrials((prev) => prev.filter((x) => x.id !== id))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
