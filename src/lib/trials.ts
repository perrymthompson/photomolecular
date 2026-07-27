import { promises as fs } from "fs";
import path from "path";
import { extractDateLabel, labelFromFilename } from "@/lib/humidity";
import { parseChamberCsv } from "@/lib/parse-csv";
import { BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import type { TrialMeta, TrialSeries } from "@/types/trial";

const DATA_DIR = path.join(process.cwd(), "data");
const CSV_DIR = path.join(DATA_DIR, "csv");
const META_PATH = path.join(DATA_DIR, "metadata.json");
const IS_VERCEL = Boolean(process.env.VERCEL);

type MetaFile = { trials: TrialMeta[] };

async function ensureLocalDirs() {
  await fs.mkdir(CSV_DIR, { recursive: true });
  try {
    await fs.access(META_PATH);
  } catch {
    await fs.writeFile(META_PATH, JSON.stringify({ trials: [] }, null, 2), "utf8");
  }
}

async function readLocalMeta(): Promise<MetaFile> {
  try {
    const raw = await fs.readFile(META_PATH, "utf8");
    return JSON.parse(raw) as MetaFile;
  } catch {
    return { trials: [] };
  }
}

async function writeLocalMeta(meta: MetaFile) {
  await ensureLocalDirs();
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
}

function canWriteLocalData() {
  return !IS_VERCEL;
}

function requireWritableLocalData(feature: string) {
  if (!canWriteLocalData()) {
    throw new Error(
      `${feature} requires Supabase on Vercel. Add the Supabase env vars before using online uploads or metadata edits.`,
    );
  }
}

function newMeta(filename: string, storagePath: string): TrialMeta {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label: labelFromFilename(filename),
    filename,
    notes: "",
    sessionStartTime: null,
    dateLabel: extractDateLabel(filename),
    storagePath,
    uploadedAt: now,
    updatedAt: now,
  };
}

/** Discover local CSVs and ensure each has a metadata row. */
export async function syncLocalInventory(): Promise<TrialMeta[]> {
  const meta = await readLocalMeta();
  let files: string[] = [];
  try {
    files = (await fs.readdir(CSV_DIR)).filter((f) => f.toLowerCase().endsWith(".csv"));
  } catch {
    files = [];
  }
  const byFile = new Map(meta.trials.map((t) => [t.filename, t]));
  let changed = false;

  for (const file of files) {
    if (!byFile.has(file)) {
      const t = newMeta(file, `local:${file}`);
      meta.trials.push(t);
      byFile.set(file, t);
      changed = true;
    }
  }

  // Drop metadata for missing local files (only local: paths)
  const next = meta.trials.filter((t) => {
    if (!t.storagePath.startsWith("local:")) return true;
    return files.includes(t.filename);
  });
  if (next.length !== meta.trials.length) {
    meta.trials = next;
    changed = true;
  }

  if (changed && canWriteLocalData()) await writeLocalMeta(meta);
  return meta.trials;
}

async function listSupabaseTrials(): Promise<TrialMeta[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from("trials")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    filename: row.filename as string,
    notes: (row.notes as string) ?? "",
    sessionStartTime: (row.session_start_time as string) ?? null,
    dateLabel: (row.date_label as string) ?? null,
    storagePath: row.storage_path as string,
    uploadedAt: row.uploaded_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function listTrials(): Promise<TrialMeta[]> {
  if (isSupabaseConfigured()) {
    try {
      const remote = await listSupabaseTrials();
      if (remote.length > 0) return remote;
      // Supabase connected but empty — fall back to bundled/local CSV inventory
    } catch {
      // fall through to local
    }
  }
  return syncLocalInventory();
}

export async function updateTrial(
  id: string,
  patch: Partial<Pick<TrialMeta, "notes" | "sessionStartTime" | "label">>,
): Promise<TrialMeta | null> {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseAdmin()!;
    const { data, error } = await sb
      .from("trials")
      .update({
        notes: patch.notes,
        session_start_time: patch.sessionStartTime,
        label: patch.label,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      label: data.label,
      filename: data.filename,
      notes: data.notes ?? "",
      sessionStartTime: data.session_start_time,
      dateLabel: data.date_label,
      storagePath: data.storage_path,
      uploadedAt: data.uploaded_at,
      updatedAt: data.updated_at,
    };
  }

  requireWritableLocalData("Editing local trial metadata");
  const meta = await readLocalMeta();
  const idx = meta.trials.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  meta.trials[idx] = {
    ...meta.trials[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeLocalMeta(meta);
  return meta.trials[idx];
}

async function readCsvText(meta: TrialMeta): Promise<string> {
  if (meta.storagePath.startsWith("local:")) {
    const file = meta.storagePath.replace(/^local:/, "");
    return fs.readFile(path.join(CSV_DIR, file), "utf8");
  }
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase not configured");
  const { data, error } = await sb.storage.from(BUCKET).download(meta.storagePath);
  if (error) throw new Error(error.message);
  return data.text();
}

export async function loadTrialSeries(id: string): Promise<TrialSeries | null> {
  const trials = await listTrials();
  const meta = trials.find((t) => t.id === id);
  if (!meta) return null;
  const text = await readCsvText(meta);
  return { meta, points: parseChamberCsv(text) };
}

export async function loadManySeries(ids: string[]): Promise<TrialSeries[]> {
  const out: TrialSeries[] = [];
  for (const id of ids) {
    const s = await loadTrialSeries(id);
    if (s) out.push(s);
  }
  return out;
}

async function assertFilenameAvailable(filename: string) {
  const safeName = filename.replace(/[^\w.\-]+/g, "_");

  if (isSupabaseConfigured()) {
    const sb = getSupabaseAdmin()!;
    const { data } = await sb
      .from("trials")
      .select("id")
      .eq("filename", safeName)
      .maybeSingle();
    if (data) {
      throw new Error(
        `A CSV named "${safeName}" already exists. Rename the file or delete the existing trial first.`,
      );
    }
    return safeName;
  }

  const meta = await readLocalMeta();
  if (meta.trials.some((t) => t.filename === safeName)) {
    throw new Error(
      `A CSV named "${safeName}" already exists. Rename the file or delete the existing trial first.`,
    );
  }
  try {
    await fs.access(path.join(CSV_DIR, safeName));
    throw new Error(
      `A CSV named "${safeName}" already exists in data/csv/. Rename the file or delete it first.`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) throw err;
  }
  return safeName;
}

export async function saveUploadedCsv(
  filename: string,
  content: Buffer | string,
): Promise<TrialMeta> {
  const safeName = await assertFilenameAvailable(filename);

  if (isSupabaseConfigured()) {
    const sb = getSupabaseAdmin()!;
    const storagePath = `${Date.now()}_${safeName}`;
    const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, body, { contentType: "text/csv", upsert: false });
    if (upErr) throw new Error(upErr.message);

    const trial = newMeta(safeName, storagePath);
    const { data, error } = await sb
      .from("trials")
      .insert({
        id: trial.id,
        label: trial.label,
        filename: trial.filename,
        notes: trial.notes,
        session_start_time: trial.sessionStartTime,
        date_label: trial.dateLabel,
        storage_path: trial.storagePath,
        uploaded_at: trial.uploadedAt,
        updated_at: trial.updatedAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: data.id,
      label: data.label,
      filename: data.filename,
      notes: data.notes ?? "",
      sessionStartTime: data.session_start_time,
      dateLabel: data.date_label,
      storagePath: data.storage_path,
      uploadedAt: data.uploaded_at,
      updatedAt: data.updated_at,
    };
  }

  requireWritableLocalData("Uploading CSVs without Supabase");
  await ensureLocalDirs();
  await fs.writeFile(
    path.join(CSV_DIR, safeName),
    typeof content === "string" ? content : content.toString("utf8"),
    "utf8",
  );
  const meta = await readLocalMeta();
  const trial = newMeta(safeName, `local:${safeName}`);
  meta.trials.push(trial);
  await writeLocalMeta(meta);
  return trial;
}

export async function deleteTrial(id: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const sb = getSupabaseAdmin()!;
    const { data } = await sb.from("trials").select("*").eq("id", id).maybeSingle();
    if (!data) return false;
    await sb.storage.from(BUCKET).remove([data.storage_path as string]);
    await sb.from("trials").delete().eq("id", id);
    return true;
  }
  requireWritableLocalData("Deleting local trial metadata");
  const meta = await readLocalMeta();
  const trial = meta.trials.find((t) => t.id === id);
  if (!trial) return false;
  if (trial.storagePath.startsWith("local:")) {
    try {
      await fs.unlink(path.join(CSV_DIR, trial.filename));
    } catch {
      /* ignore */
    }
  }
  meta.trials = meta.trials.filter((t) => t.id !== id);
  await writeLocalMeta(meta);
  return true;
}
