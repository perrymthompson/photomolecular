"use client";

import { useEffect, useState } from "react";
import type { TrialMeta, TrialSeries } from "@/types/trial";

type Props = {
  series: TrialSeries[];
  onSaved: (t: TrialMeta) => void;
};

type Draft = {
  notes: string;
  dirty: boolean;
  saving: boolean;
  status: string | null;
  statusOk: boolean;
};

function trialTitle(t: TrialMeta): string {
  const short = t.filename.replace(/\.csv$/i, "");
  return `${t.label} · ${short}`;
}

function previewText(notes: string, max = 72): string {
  const oneLine = notes.replace(/\s+/g, " ").trim();
  if (!oneLine) return "No notes yet";
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

export function PlotTrialNotes({ series, onSaved }: Props) {
  const [moduleOpen, setModuleOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      for (const s of series) {
        const existing = prev[s.meta.id];
        next[s.meta.id] = existing?.dirty
          ? existing
          : {
              notes: s.meta.notes ?? "",
              dirty: false,
              saving: false,
              status: null,
              statusOk: false,
            };
      }
      return next;
    });
  }, [series]);

  if (series.length === 0) return null;

  const withNotes = series.filter((s) => (s.meta.notes ?? "").trim()).length;

  const setDraftNotes = (id: string, notes: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? {
          notes: "",
          dirty: false,
          saving: false,
          status: null,
          statusOk: false,
        }),
        notes,
        dirty: true,
        status: null,
      },
    }));
  };

  const save = async (trial: TrialMeta) => {
    const draft = drafts[trial.id];
    if (!draft) return;
    setDrafts((prev) => ({
      ...prev,
      [trial.id]: { ...draft, saving: true, status: null },
    }));
    try {
      const res = await fetch(`/api/trials/${trial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft.notes }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to save notes");
      }
      const data = (await res.json()) as TrialMeta;
      onSaved(data);
      setDrafts((prev) => ({
        ...prev,
        [trial.id]: {
          notes: data.notes ?? "",
          dirty: false,
          saving: false,
          status: "Saved",
          statusOk: true,
        },
      }));
    } catch (e) {
      setDrafts((prev) => ({
        ...prev,
        [trial.id]: {
          ...draft,
          saving: false,
          status: e instanceof Error ? e.message : "Save failed",
          statusOk: false,
        },
      }));
    }
  };

  return (
    <div className="rounded-lg border border-border bg-panel-elevated">
      <button
        type="button"
        onClick={() => setModuleOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-panel"
      >
        <div>
          <h3 className="text-sm font-medium text-foreground">Trial notes</h3>
          <p className="mt-0.5 text-xs text-faint">
            {series.length} plotted trial{series.length === 1 ? "" : "s"}
            {withNotes > 0 ? ` · ${withNotes} with notes` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted">
          {moduleOpen ? "Collapse ▲" : "Expand ▼"}
        </span>
      </button>

      {moduleOpen ? (
        <div className="scrollbar-themed max-h-[min(50vh,520px)] space-y-2 overflow-y-auto border-t border-border px-4 py-3">
          {series.map((s) => {
            const draft = drafts[s.meta.id] ?? {
              notes: s.meta.notes ?? "",
              dirty: false,
              saving: false,
              status: null,
              statusOk: false,
            };
            const expanded = expandedId === s.meta.id;

            return (
              <div
                key={s.meta.id}
                className="rounded border border-border bg-panel"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((id) => (id === s.meta.id ? null : s.meta.id))
                  }
                  className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-surface"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {trialTitle(s.meta)}
                    </p>
                    {!expanded ? (
                      <p className="mt-0.5 truncate text-xs text-faint">
                        {previewText(draft.notes)}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] text-faint">
                    {expanded ? "▲" : "▼"}
                  </span>
                </button>

                {expanded ? (
                  <div className="space-y-2 border-t border-border px-3 py-3">
                    <textarea
                      rows={6}
                      className="scrollbar-themed w-full resize-y rounded border border-border bg-panel-elevated px-2 py-1.5 text-sm text-foreground"
                      value={draft.notes}
                      onChange={(e) => setDraftNotes(s.meta.id, e.target.value)}
                      placeholder="Long-form notes for this CSV…"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={draft.saving || !draft.dirty}
                        onClick={() => void save(s.meta)}
                        className="rounded bg-steel px-3 py-1.5 text-xs font-medium text-foreground hover:brightness-110 disabled:opacity-50"
                      >
                        {draft.saving ? "Saving…" : "Save notes"}
                      </button>
                      {draft.status ? (
                        <span
                          className={`text-xs ${draft.statusOk ? "text-emerald-500" : "text-coral"}`}
                        >
                          {draft.status}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
