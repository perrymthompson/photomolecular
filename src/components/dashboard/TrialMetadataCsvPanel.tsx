"use client";

import { useState } from "react";
import { TRIAL_METADATA_REL_PATH } from "@/lib/trial-metadata-path";

const LOAD_WARNING =
  "Load will replace the editor with the saved trial-metadata.csv from the server. Any unsaved edits in this box will be lost. Continue?";

const SAVE_WARNING = `Save will overwrite ${TRIAL_METADATA_REL_PATH} (and the Supabase storage copy when deployed). This does not update trial records until you click Run DataImport. Continue?`;

export function TrialMetadataCsvPanel() {
  const [csvText, setCsvText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const load = async () => {
    if (!window.confirm(LOAD_WARNING)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/import/trial-metadata");
      const body = (await res.json()) as {
        ok?: boolean;
        csvText?: string;
        source?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to load trial-metadata.csv");
      }
      setCsvText(body.csvText ?? "");
      setLoaded(true);
      setDirty(false);
      setOk(true);
      setMessage(
        `Loaded from ${body.source === "storage" ? "Supabase storage" : "repo file"}.`,
      );
    } catch (e) {
      setOk(false);
      setMessage(e instanceof Error ? e.message : "Load failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!window.confirm(SAVE_WARNING)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/import/trial-metadata", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        destination?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to save trial-metadata.csv");
      }
      setDirty(false);
      setOk(true);
      setMessage(
        body.destination === "storage"
          ? "Saved to Supabase storage."
          : "Saved to local data/import/trial-metadata.csv.",
      );
    } catch (e) {
      setOk(false);
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#3a3b3f] bg-[#1e1f22] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">Trial metadata CSV</h2>
          <p className="mt-1 text-xs text-[#8a8a8d]">
            Edit <code className="text-[#b5b5b8]">{TRIAL_METADATA_REL_PATH}</code>
            , then use <strong className="font-normal text-[#b5b5b8]">Run DataImport</strong>{" "}
            above to push plot labels, session starts, and notes into the database.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="rounded border border-[#4C8FD1] px-3 py-1.5 text-xs font-medium text-[#4C8FD1] hover:bg-[#4C8FD1]/10 disabled:opacity-50"
          >
            {busy ? "Working…" : "Load CSV"}
          </button>
          <button
            type="button"
            disabled={busy || !loaded}
            onClick={() => void save()}
            className="rounded bg-[#4C8FD1] px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Working…" : "Save CSV"}
          </button>
        </div>
      </div>

      <textarea
        rows={10}
        spellCheck={false}
        placeholder="Click Load CSV to open trial-metadata.csv…"
        className="scrollbar-themed mt-3 w-full resize-y rounded border border-[#3a3b3f] bg-[#16171a] px-2 py-1.5 font-mono text-xs text-[#e8e8e8]"
        value={csvText}
        onChange={(e) => {
          setCsvText(e.target.value);
          setDirty(true);
        }}
      />

      {dirty ? (
        <p className="mt-2 text-xs text-[#F0AD4E]">Unsaved changes in editor.</p>
      ) : null}

      {message ? (
        <p
          className={`mt-2 text-xs ${ok ? "text-[#5CB85C]" : "text-[#E2574C]"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
