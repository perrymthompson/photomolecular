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

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csv/sync", { method: "POST" });
      const body = (await res.json()) as SyncResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Sync failed");
      setOk(body.uploaded.length > 0 || body.scanned > 0);
      setMessage(
        body.uploaded.length
          ? `${body.message}\nNew: ${body.uploaded.join(", ")}`
          : body.message,
      );
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
            Same as <code className="text-[#b5b5b8]">npm run sync</code>: scan{" "}
            <code className="text-[#b5b5b8]">data/csv/</code> and register any
            new files. On Vercel this only sees CSVs committed in the repo —
            use upload above for brand-new files on the live site.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="shrink-0 rounded bg-[#4C8FD1] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Run sync"}
        </button>
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
