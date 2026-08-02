"use client";

import { useState } from "react";
import type { TrialMeta } from "@/types/trial";

type Props = {
  existingFilenames: string[];
  onUploaded: (trials: TrialMeta[]) => void;
};

function safeName(filename: string) {
  return filename.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_");
}

async function parseApiError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* fall through */
  }
  return (await res.text()) || `Upload failed (${res.status})`;
}

export function CsvUploader({ existingFilenames, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);

    const existing = new Set(existingFilenames.map(safeName));
    const uploaded: TrialMeta[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      const name = safeName(file.name);
      if (existing.has(name)) {
        errors.push(`${file.name}: already exists (duplicate filename).`);
        continue;
      }

      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/csv/upload", { method: "POST", body: fd });
        if (!res.ok) {
          errors.push(`${file.name}: ${await parseApiError(res)}`);
          continue;
        }
        const trial = (await res.json()) as TrialMeta;
        uploaded.push(trial);
        existing.add(name);
      } catch (e) {
        errors.push(
          `${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`,
        );
      }
    }

    if (uploaded.length) onUploaded(uploaded);

    if (uploaded.length && !errors.length) {
      setMessageOk(true);
      setMessage(`Success: uploaded ${uploaded.length} file(s).`);
    } else if (uploaded.length && errors.length) {
      setMessageOk(false);
      setMessage(
        `Partial success: uploaded ${uploaded.length}, failed ${errors.length}.\n${errors.join("\n")}`,
      );
    } else {
      setMessageOk(false);
      setMessage(errors.join("\n") || "Upload failed.");
    }

    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-dashed border-border bg-panel p-6 text-center">
      <p className="mb-3 text-sm text-muted">
        Upload chamber CSV files (same format as your R script). Duplicate filenames
        are rejected.
      </p>
      <label className="inline-flex cursor-pointer items-center rounded bg-coral px-4 py-2 text-sm font-medium text-foreground hover:brightness-110">
        {busy ? "Uploading…" : "Choose CSV files"}
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {message ? (
        <p
          className={`mt-3 whitespace-pre-line text-left text-xs ${
            messageOk ? "text-emerald-500" : "text-coral"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
