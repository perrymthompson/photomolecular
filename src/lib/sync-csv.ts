/**
 * Same job as `npm run sync` / scripts/sync-csv.mjs, callable from the API.
 *
 * Scans data/csv/*.csv and registers any file not already in the trials table
 * (uploads to Supabase Storage when configured; otherwise refreshes local metadata).
 *
 * With `refresh: true`, re-uploads local CSV bytes onto existing storage paths
 * (keeps notes, bookmarks, session starts on the trial row).
 *
 * On Vercel this only sees CSVs that were committed into the repo under data/csv/.
 * Brand-new files on the live site should use Dashboard upload instead.
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { extractDateLabel, labelFromFilename } from "@/lib/humidity";
import { BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import type { TrialMeta } from "@/types/trial";

const CSV_DIR = path.join(process.cwd(), "data", "csv");
const META_PATH = path.join(process.cwd(), "data", "metadata.json");
const IS_VERCEL = Boolean(process.env.VERCEL);

export type SyncResult = {
  scanned: number;
  uploaded: string[];
  refreshed: string[];
  skipped: string[];
  mode: "supabase" | "local";
  message: string;
};

export type SyncOptions = {
  /** Re-upload changed CSVs for trials already registered (preserves metadata). */
  refresh?: boolean;
};

function contentHash(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex").slice(0, 10);
}

function storagePathForUpload(filename: string, buf: Buffer): string {
  const hash = contentHash(buf);
  const safeFile = filename.replace(/[^\w.\-]+/g, "_");
  return `${hash}_${safeFile}`;
}

async function listLocalCsvFiles(): Promise<string[]> {
  try {
    return (await fs.readdir(CSV_DIR)).filter((f) =>
      f.toLowerCase().endsWith(".csv"),
    );
  } catch {
    return [];
  }
}

async function syncLocal(): Promise<SyncResult> {
  if (IS_VERCEL) {
    return {
      scanned: 0,
      uploaded: [],
      refreshed: [],
      skipped: [],
      mode: "local",
      message:
        "Local-only sync cannot write on Vercel. Configure Supabase, or upload CSVs from the Dashboard.",
    };
  }

  const files = await listLocalCsvFiles();
  let meta: { trials: TrialMeta[] } = { trials: [] };
  try {
    meta = JSON.parse(await fs.readFile(META_PATH, "utf8")) as {
      trials: TrialMeta[];
    };
  } catch {
    meta = { trials: [] };
  }

  const byName = new Map(meta.trials.map((t) => [t.filename, t]));
  const uploaded: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (byName.has(file)) {
      skipped.push(file);
      continue;
    }
    const now = new Date().toISOString();
    meta.trials.push({
      id: crypto.randomUUID(),
      label: labelFromFilename(file),
      filename: file,
      notes: "",
      sessionStartTime: null,
      dateLabel: extractDateLabel(file),
      storagePath: `local:${file}`,
      bookmarks: [],
      uploadedAt: now,
      updatedAt: now,
    });
    uploaded.push(file);
  }

  meta.trials = meta.trials.filter(
    (t) => !t.storagePath.startsWith("local:") || files.includes(t.filename),
  );

  await fs.mkdir(CSV_DIR, { recursive: true });
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");

  return {
    scanned: files.length,
    uploaded,
    refreshed: [],
    skipped,
    mode: "local",
    message:
      uploaded.length > 0
        ? `Registered ${uploaded.length} new local CSV(s).`
        : `No new files. Scanned ${files.length} CSV(s) in data/csv/. Local mode reads CSVs from disk directly — overwrite files there to refresh plots.`,
  };
}

type TrialRow = {
  filename: string;
  storage_path: string;
};

async function syncSupabase(options: SyncOptions): Promise<SyncResult> {
  const sb = getSupabaseAdmin();
  if (!sb) return syncLocal();

  const refresh = options.refresh ?? false;
  const files = await listLocalCsvFiles();
  const { data: existing, error } = await sb
    .from("trials")
    .select("filename, storage_path");
  if (error) throw new Error(error.message);

  const byFilename = new Map(
    (existing ?? []).map((r) => [
      (r as TrialRow).filename,
      r as TrialRow,
    ]),
  );
  const uploaded: string[] = [];
  const refreshed: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const buf = await fs.readFile(path.join(CSV_DIR, file));
    const row = byFilename.get(file);

    if (row) {
      if (!refresh) {
        skipped.push(file);
        continue;
      }
      const newPath = storagePathForUpload(file, buf);
      if (newPath === row.storage_path) {
        skipped.push(file);
        continue;
      }
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(newPath, buf, {
          contentType: "text/csv",
          upsert: true,
        });
      if (upErr) throw new Error(`${file}: ${upErr.message}`);

      if (newPath !== row.storage_path) {
        const { error: metaErr } = await sb
          .from("trials")
          .update({
            storage_path: newPath,
            updated_at: new Date().toISOString(),
          })
          .eq("filename", file);
        if (metaErr) throw new Error(`${file}: ${metaErr.message}`);
        await sb.storage.from(BUCKET).remove([row.storage_path]);
      }

      refreshed.push(file);
      continue;
    }

    const storagePath = storagePathForUpload(file, buf);

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, buf, { contentType: "text/csv", upsert: false });
    if (upErr && !/already exists/i.test(upErr.message)) {
      throw new Error(`${file}: ${upErr.message}`);
    }

    const now = new Date().toISOString();
    const { error: insErr } = await sb.from("trials").insert({
      id: crypto.randomUUID(),
      label: labelFromFilename(file),
      filename: file,
      notes: "",
      session_start_time: null,
      date_label: extractDateLabel(file),
      storage_path: storagePath,
      bookmarks: [],
      uploaded_at: now,
      updated_at: now,
    });
    if (insErr) throw new Error(`${file}: ${insErr.message}`);
    uploaded.push(file);
  }

  const parts: string[] = [];
  if (uploaded.length) parts.push(`${uploaded.length} new`);
  if (refreshed.length) parts.push(`${refreshed.length} refreshed`);
  if (skipped.length && !uploaded.length && !refreshed.length) {
    parts.push(
      refresh
        ? `${skipped.length} unchanged`
        : `${skipped.length} already registered`,
    );
  }

  return {
    scanned: files.length,
    uploaded,
    refreshed,
    skipped,
    mode: "supabase",
    message:
      files.length === 0
        ? "No CSV files found in data/csv/. Drop files there (or upload via Dashboard)."
        : parts.length
          ? `Sync complete: ${parts.join(", ")}.`
          : "Nothing to sync.",
  };
}

/** Run inventory sync (local folder → Supabase or local metadata). */
export async function runCsvSync(options: SyncOptions = {}): Promise<SyncResult> {
  if (isSupabaseConfigured()) return syncSupabase(options);
  return syncLocal();
}
