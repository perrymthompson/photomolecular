"use client";

import { useState } from "react";
import type { TrialMeta, TrialSeries } from "@/types/trial";

type Props = {
  series: TrialSeries[];
  onSaved: (t: TrialMeta) => void;
};

export function PlotBookmarkAdd({ series, onSaved }: Props) {
  const [trialId, setTrialId] = useState(series[0]?.meta.id ?? "");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState(false);

  if (series.length === 0) return null;

  const activeId = series.some((s) => s.meta.id === trialId)
    ? trialId
    : series[0].meta.id;
  const selected = series.find((s) => s.meta.id === activeId)!;

  const add = async () => {
    const t = time.trim();
    const n = note.trim();
    if (!t || !n) {
      setStatusOk(false);
      setStatus("Enter both a time and a note.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const next = [
        ...(selected.meta.bookmarks ?? []),
        { id: crypto.randomUUID(), time: t, note: n },
      ];
      const res = await fetch(`/api/trials/${selected.meta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarks: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to add bookmark");
      }
      const data = (await res.json()) as TrialMeta;
      onSaved(data);
      setTime("");
      setNote("");
      setStatusOk(true);
      setStatus("Bookmark added — hover the marker on the plot.");
    } catch (e) {
      setStatusOk(false);
      setStatus(e instanceof Error ? e.message : "Failed to add bookmark");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#3a3b3f] bg-[#16171a] p-4">
      <h3 className="text-sm font-medium text-white">Add plot bookmark</h3>
      <p className="mt-1 text-xs text-[#8a8a8d]">
        Quick note at a clock time for a trial currently plotted. Full edit list
        is on the Dashboard.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1.2fr_0.8fr_1.4fr_auto]">
        <label className="block text-xs text-[#b5b5b8]">
          Trial
          <select
            className="mt-1 w-full rounded border border-[#3a3b3f] bg-[#1e1f22] px-2 py-1.5 text-sm text-[#e8e8e8]"
            value={activeId}
            onChange={(e) => setTrialId(e.target.value)}
          >
            {series.map((s) => (
              <option key={s.meta.id} value={s.meta.id}>
                {s.meta.label} · {s.meta.filename}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-[#b5b5b8]">
          Time (HH:MM:SS)
          <input
            className="mt-1 w-full rounded border border-[#3a3b3f] bg-[#1e1f22] px-2 py-1.5 text-sm text-[#e8e8e8]"
            placeholder="06:00:00"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="block text-xs text-[#b5b5b8]">
          Note
          <input
            className="mt-1 w-full rounded border border-[#3a3b3f] bg-[#1e1f22] px-2 py-1.5 text-sm text-[#e8e8e8]"
            placeholder="Turned UV on"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void add()}
          className="self-end rounded bg-[#E2574C] px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {status ? (
        <p
          className={`mt-2 text-xs ${statusOk ? "text-[#5CB85C]" : "text-[#E2574C]"}`}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
