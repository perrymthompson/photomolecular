"use client";

import { useState } from "react";
import type { DataImportResult } from "@/lib/import-dataimport";
import type { SyncResult } from "@/lib/sync-csv";

type Props = {
  onSynced: () => void;
};

const IMPORT_WARNING =
  "Run DataImport will overwrite plot_label, session_start_time, and notes on all matching ch1/ch2 trials from trial-metadata.csv. This cannot be undone easily. Continue?";

export function SyncFolderButton({ onSynced }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const run = async (refresh: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csv/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      const body = (await res.json()) as SyncResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      setOk(
        body.uploaded.length > 0 ||
          body.refreshed.length > 0 ||
          body.scanned > 0,
      );
      const lines = [body.message];
      if (body.uploaded.length) lines.push(`New: ${body.uploaded.join(", ")}`);
      if (body.refreshed.length) {
        lines.push(`Refreshed: ${body.refreshed.join(", ")}`);
      }
      setMessage(lines.join("\n"));
      onSynced();
    } catch (e) {
      setOk(false);
      setMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const runDataImport = async () => {
    if (!window.confirm(IMPORT_WARNING)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csv/dataimport", { method: "POST" });
      const body = (await res.json()) as DataImportResult & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error ?? "DataImport run failed");
      }
      setOk(true);
      setMessage(body.message);
      onSynced();
    } catch (e) {
      setOk(false);
      setMessage(e instanceof Error ? e.message : "DataImport run failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Sync folder CSVs</h2>
          <p className="mt-1 text-xs text-faint">
            Scan <code className="text-muted">data/csv/</code>.{" "}
            <strong className="font-normal text-muted">Run sync</strong>{" "}
            registers new files.{" "}
            <strong className="font-normal text-muted">Refresh data</strong>{" "}
            re-uploads changed CSVs and keeps notes / bookmarks / session
            starts.{" "}
            <strong className="font-normal text-muted">Run DataImport</strong>{" "}
            applies <code className="text-muted">data/import/trial-metadata.csv</code>{" "}
            to matching trials.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(false)}
            className="rounded bg-steel px-4 py-2 text-sm font-medium text-foreground hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Working…" : "Run sync"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            title="Overwrite Supabase CSV data for files already registered (metadata preserved)"
            className="rounded border border-steel px-4 py-2 text-sm font-medium text-steel hover:bg-steel/10 disabled:opacity-50"
          >
            {busy ? "Working…" : "Refresh data"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runDataImport()}
            title="Apply plot labels, notes, and session starts from data/import/trial-metadata.csv"
            className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
          >
            {busy ? "Working…" : "Run DataImport"}
          </button>
        </div>
      </div>
      {message ? (
        <p
          className={`mt-3 whitespace-pre-line text-xs ${
            ok ? "text-emerald-500" : "text-coral"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
