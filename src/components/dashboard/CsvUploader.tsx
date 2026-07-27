"use client";

import { useState } from "react";
import type { TrialMeta } from "@/types/trial";

type Props = {
  onUploaded: (trials: TrialMeta[]) => void;
};

export function CsvUploader({ onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    const uploaded: TrialMeta[] = [];
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/csv/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error(await res.text());
        uploaded.push((await res.json()) as TrialMeta);
      }
      onUploaded(uploaded);
      setMessage(`Uploaded ${uploaded.length} file(s).`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-[#3a3b3f] bg-[#1e1f22] p-6 text-center">
      <p className="mb-3 text-sm text-[#b5b5b8]">
        Upload chamber CSV files (same format as your R script), or drop them into{" "}
        <code className="text-[#e8e8e8]">data/csv/</code> and run{" "}
        <code className="text-[#e8e8e8]">npm run sync</code>.
      </p>
      <label className="inline-flex cursor-pointer items-center rounded bg-[#E2574C] px-4 py-2 text-sm font-medium text-white hover:brightness-110">
        {busy ? "Uploading…" : "Choose CSV files"}
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => upload(e.target.files)}
        />
      </label>
      {message ? <p className="mt-3 text-xs text-[#b5b5b8]">{message}</p> : null}
    </div>
  );
}
