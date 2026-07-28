"use client";

import { useEffect, useState } from "react";

type Props = {
  onImported: () => void;
};

type ImportResponse = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export function DataImportEditor({ onImported }: Props) {
  const [csvText, setCsvText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csv/dataimport", { method: "GET" });
      const data = (await res.json()) as { csvText?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load DataImport.csv");
      setCsvText(data.csvText ?? "");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to load DataImport.csv");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csv/dataimport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = (await res.json()) as ImportResponse & { error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Import failed");
      }

      const parts: string[] = [];
      if (data.stdout) parts.push(data.stdout.trim());
      if (data.stderr) parts.push(`stderr:\n${data.stderr.trim()}`);
      setMessage(parts.join("\n\n") || "Import applied.");
      onImported();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#3a3b3f] bg-[#1e1f22] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[260px]">
          <h2 className="text-sm font-medium text-white">Update from DataImport.csv</h2>
          <p className="mt-1 text-xs text-[#8a8a8d]">
            Edit the CSV mapping in the box, then run the one-time import script to update
            plot labels, start times, and notes for matching trials.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
            className="rounded border border-[#4C8FD1] px-4 py-2 text-sm font-medium text-[#4C8FD1] hover:bg-[#4C8FD1]/10 disabled:opacity-50"
          >
            {busy ? "Working…" : "Reload file"}
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void apply()}
            className="rounded bg-[#4C8FD1] px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Applying…" : "Run import"}
          </button>
        </div>
      </div>

      <div className="mt-3">
        {loading ? (
          <p className="text-xs text-[#8a8a8d]">Loading DataImport.csv…</p>
        ) : null}

        <textarea
          rows={14}
          spellCheck={false}
          className="scrollbar-themed mt-2 w-full resize-y rounded border border-[#3a3b3f] bg-[#16171a] px-2 py-1.5 font-mono text-xs text-[#e8e8e8]"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
        />
      </div>

      {message ? (
        <p className={`mt-3 whitespace-pre-line text-xs ${message.includes("Import failed") ? "text-[#E2574C]" : "text-[#b5b5b8]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

