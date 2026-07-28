/**
 * Same job as `npm run sync` / scripts/sync-csv.mjs, callable from the API.
 *
 * Scans data/csv/*.csv and registers any file not already in the trials table
 * (uploads to Supabase Storage when configured; otherwise refreshes local metadata).
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
  skipped: string[];
  mode: "supabase" | "local";
  message: string;
};

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
    skipped,
    mode: "local",
    message:
      uploaded.length > 0
        ? `Registered ${uploaded.length} new local CSV(s).`
        : `No new files. Scanned ${files.length} CSV(s) in data/csv/.`,
  };
}

async function syncSupabase(): Promise<SyncResult> {
  const sb = getSupabaseAdmin();
  if (!sb) return syncLocal();

  const files = await listLocalCsvFiles();
  const { data: existing, error } = await sb.from("trials").select("filename");
  if (error) throw new Error(error.message);

  const byFilename = new Set((existing ?? []).map((r) => r.filename as string));
  const uploaded: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (byFilename.has(file)) {
      skipped.push(file);
      continue;
    }

    const buf = await fs.readFile(path.join(CSV_DIR, file));
    const hash = createHash("sha1").update(buf).digest("hex").slice(0, 10);
    const storagePath = `${hash}_${file}`;

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

  return {
    scanned: files.length,
    uploaded,
    skipped,
    mode: "supabase",
    message:
      uploaded.length > 0
        ? `Synced ${uploaded.length} new CSV(s) from data/csv/ to Supabase.`
        : files.length === 0
          ? "No CSV files found in data/csv/. Drop files there (or upload via Dashboard)."
          : `No new files. ${skipped.length} CSV(s) already registered.`,
  };
}

/** Run inventory sync (local folder → Supabase or local metadata). */
export async function runCsvSync(): Promise<SyncResult> {
  if (isSupabaseConfigured()) return syncSupabase();
  return syncLocal();
}
