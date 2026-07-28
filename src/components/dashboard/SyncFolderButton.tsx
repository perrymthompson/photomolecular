"use client";

import { useState } from "react";
import type { SyncResult } from "@/lib/sync-csv";

type Props = {
  onSynced: () => void;
};

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

  return (
    <div className="rounded-lg border border-[#3a3b3f] bg-[#1e1f22] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">Sync folder CSVs</h2>
          <p className="mt-1 text-xs text-[#8a8a8d]">
            Scan <code className="text-[#b5b5b8]">data/csv/</code>.{" "}
            <strong className="font-normal text-[#b5b5b8]">Run sync</strong>{" "}
            registers new files.{" "}
            <strong className="font-normal text-[#b5b5b8]">Refresh data</strong>{" "}
            re-uploads changed CSVs and keeps notes / bookmarks / session
            starts.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(false)}
            className="rounded bg-[#4C8FD1] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Working…" : "Run sync"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(true)}
            title="Overwrite Supabase CSV data for files already registered (metadata preserved)"
            className="rounded border border-[#4C8FD1] px-4 py-2 text-sm font-medium text-[#4C8FD1] hover:bg-[#4C8FD1]/10 disabled:opacity-50"
          >
            {busy ? "Working…" : "Refresh data"}
          </button>
        </div>
      </div>
      {message ? (
        <p
          className={`mt-3 whitespace-pre-line text-xs ${
            ok ? "text-[#5CB85C]" : "text-[#E2574C]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
