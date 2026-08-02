"use client";

import { useEffect, useState } from "react";
import type { TrialBookmark, TrialMeta } from "@/types/trial";

type Props = {
  trial: TrialMeta;
  onSaved: (t: TrialMeta) => void;
};

function emptyDraft(): TrialBookmark {
  return { id: crypto.randomUUID(), time: "", note: "" };
}

export function TrialBookmarksEditor({ trial, onSaved }: Props) {
  const [bookmarks, setBookmarks] = useState<TrialBookmark[]>(
    trial.bookmarks?.length ? trial.bookmarks : [],
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setBookmarks(trial.bookmarks?.length ? trial.bookmarks : []);
  }, [trial.id, trial.bookmarks]);

  const save = async (next: TrialBookmark[]) => {
    setBusy(true);
    setStatus(null);
    try {
      const cleaned = next
        .map((b) => ({
          id: b.id || crypto.randomUUID(),
          time: b.time.trim(),
          note: b.note.trim(),
        }))
        .filter((b) => b.time && b.note);

      const res = await fetch(`/api/trials/${trial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarks: cleaned }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to save bookmarks");
      }
      const data = (await res.json()) as TrialMeta;
      setBookmarks(data.bookmarks ?? []);
      onSaved(data);
      setStatus("Bookmarks saved");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-faint">
          Time bookmarks
        </h4>
        <button
          type="button"
          disabled={busy}
          onClick={() => setBookmarks((prev) => [...prev, emptyDraft()])}
          className="text-xs text-steel hover:underline disabled:opacity-50"
        >
          + Add bookmark
        </button>
      </div>
      <p className="mb-2 text-[11px] text-faint">
        Clock time on this trial&apos;s day (e.g. 06:00:00). Markers appear on
        the plot; hover to read the note.
      </p>

      {bookmarks.length === 0 ? (
        <p className="text-xs text-faint">No bookmarks yet.</p>
      ) : (
        <ul className="space-y-2">
          {bookmarks.map((b, idx) => (
            <li
              key={b.id}
              className="grid gap-2 rounded border border-border bg-panel-elevated p-2 sm:grid-cols-[120px_1fr_auto]"
            >
              <label className="block text-[11px] text-muted">
                Time
                <input
                  className="mt-0.5 w-full rounded border border-border bg-panel px-2 py-1 text-sm text-foreground"
                  placeholder="06:00:00"
                  value={b.time}
                  onChange={(e) =>
                    setBookmarks((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, time: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label className="block text-[11px] text-muted">
                Note
                <input
                  className="mt-0.5 w-full rounded border border-border bg-panel px-2 py-1 text-sm text-foreground"
                  placeholder="Turned something on"
                  value={b.note}
                  onChange={(e) =>
                    setBookmarks((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, note: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setBookmarks((prev) => prev.filter((_, i) => i !== idx))
                }
                className="self-end text-xs text-coral hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(bookmarks)}
          className="rounded bg-steel px-3 py-1.5 text-xs font-medium text-foreground hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save bookmarks"}
        </button>
        {status ? <span className="text-xs text-muted">{status}</span> : null}
      </div>
    </div>
  );
}
