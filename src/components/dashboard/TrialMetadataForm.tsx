"use client";

import { useState } from "react";
import { TrialBookmarksEditor } from "@/components/dashboard/TrialBookmarksEditor";
import type { TrialMeta } from "@/types/trial";

type Props = {
  trial: TrialMeta;
  onSaved: (t: TrialMeta) => void;
  onDeleted: (id: string) => void;
};

export function TrialMetadataForm({ trial, onSaved, onDeleted }: Props) {
  const [notes, setNotes] = useState(trial.notes);
  const [plotLabel, setPlotLabel] = useState(trial.plotLabel ?? "");
  const [sessionStartTime, setSessionStartTime] = useState(
    trial.sessionStartTime ?? "",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/trials/${trial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          plotLabel: plotLabel.trim(),
          sessionStartTime: sessionStartTime.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TrialMeta;
      onSaved(data);
      setStatus("Saved");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${trial.filename}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trials/${trial.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onDeleted(trial.id);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#3a3b3f] bg-[#1e1f22] p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-white">{trial.filename}</h3>
          {trial.dateLabel ? (
            <p className="text-xs text-[#8a8a8d]">{trial.dateLabel}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs text-[#E2574C] hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-[#b5b5b8]">
          Channel
          <input
            className="mt-1 w-full rounded border border-[#3a3b3f] bg-[#16171a] px-2 py-1.5 text-sm text-[#8a8a8d]"
            value={trial.label}
            readOnly
          />
        </label>
        <label className="block text-xs text-[#b5b5b8] sm:col-span-2">
          Plot label
          <input
            className="mt-1 w-full rounded border border-[#3a3b3f] bg-[#16171a] px-2 py-1.5 text-sm text-[#e8e8e8]"
            placeholder='e.g. "Dark" or "Light, 45°"'
            value={plotLabel}
            onChange={(e) => setPlotLabel(e.target.value)}
          />
        </label>
        <label className="block text-xs text-[#b5b5b8] sm:col-span-3">
          Session start (HH:MM:SS, 24h)
          <input
            className="mt-1 w-full rounded border border-[#3a3b3f] bg-[#16171a] px-2 py-1.5 text-sm text-[#e8e8e8]"
            placeholder="12:38:00"
            value={sessionStartTime}
            onChange={(e) => setSessionStartTime(e.target.value)}
          />
        </label>
        <label className="block text-xs text-[#b5b5b8] sm:col-span-3">
          Notes
          <textarea
            rows={4}
            className="scrollbar-themed mt-1 w-full resize-y rounded border border-[#3a3b3f] bg-[#16171a] px-2 py-1.5 text-sm text-[#e8e8e8]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-[#4C8FD1] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {status ? <span className="text-xs text-[#b5b5b8]">{status}</span> : null}
      </div>

      <TrialBookmarksEditor trial={trial} onSaved={onSaved} />
    </div>
  );
}
