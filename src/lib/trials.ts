import { promises as fs } from "fs";
import path from "path";
import { extractDateLabel, labelFromFilename } from "@/lib/humidity";
import { parseChamberCsv } from "@/lib/parse-csv";
import { BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  computeXRunDynamicEndBookmarks,
} from "@/lib/x-run-dynamic-bookmarks";
import {
  collectMirroredBookmarks,
  findXRunTrial,
  mergeMirroredBookmarks,
} from "@/lib/x-run-mirror";
import type { TrialBookmark, TrialMeta, TrialSeries } from "@/types/trial";

const DATA_DIR = path.join(process.cwd(), "data");
const CSV_DIR = path.join(DATA_DIR, "csv");
const META_PATH = path.join(DATA_DIR, "metadata.json");
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_SOURCE_MODE = process.env.PLOT_DATA_SOURCE;

type MetaFile = { trials: TrialMeta[] };

function dataSourceMode(): "auto" | "local" | "remote" {
  return DATA_SOURCE_MODE === "local" || DATA_SOURCE_MODE === "remote"
    ? DATA_SOURCE_MODE
    : "auto";
}

function shouldUseSupabase(): boolean {
  return dataSourceMode() === "remote"
    ? true
    : dataSourceMode() === "local"
      ? false
      : isSupabaseConfigured();
}

function requireSupabaseConfigured(feature: string) {
  if (!isSupabaseConfigured()) {
    throw new Error(
      `${feature} requires Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.`,
    );
  }
}

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

function normalizeBookmarks(raw: unknown): TrialBookmark[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const row = b as Record<string, unknown>;
      const time = typeof row.time === "string" ? row.time.trim() : "";
      const note = typeof row.note === "string" ? row.note.trim() : "";
      if (!time || !note) return null;
      return {
        id:
          typeof row.id === "string" && row.id
            ? row.id
            : crypto.randomUUID(),
        time,
        note,
      };
    })
    .filter((b): b is TrialBookmark => b !== null);
}

function rowToMeta(row: Record<string, unknown>): TrialMeta {
  return {
    id: row.id as string,
    label: row.label as string,
    filename: row.filename as string,
    plotLabel: (row.plot_label as string | undefined) ?? "",
    notes: (row.notes as string) ?? "",
    sessionStartTime: (row.session_start_time as string) ?? null,
    dateLabel: (row.date_label as string) ?? null,
    storagePath: row.storage_path as string,
    bookmarks: normalizeBookmarks(row.bookmarks),
    uploadedAt: row.uploaded_at as string,
    updatedAt: row.updated_at as string,
  };
}

function newMeta(filename: string, storagePath: string): TrialMeta {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label: labelFromFilename(filename),
    filename,
    plotLabel: "",
    notes: "",
    sessionStartTime: null,
    dateLabel: extractDateLabel(filename),
    storagePath,
    bookmarks: [],
    uploadedAt: now,
    updatedAt: now,
  };
}

/** Discover local CSVs and ensure each has a metadata row. */
export async function syncLocalInventory(): Promise<TrialMeta[]> {
  const meta = await readLocalMeta();
  let files: string[] = [];
  try {
    files = (await fs.readdir(CSV_DIR)).filter(
      (f) =>
        f.toLowerCase().endsWith(".csv") &&
        f.toLowerCase() !== "dataimport.csv",
    );
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
  return meta.trials.map((t) => ({
    ...t,
    plotLabel: t.plotLabel ?? "",
    bookmarks: normalizeBookmarks(t.bookmarks),
  }));
}

async function listSupabaseTrials(): Promise<TrialMeta[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from("trials")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => rowToMeta(row as Record<string, unknown>));
}

export async function listTrials(): Promise<TrialMeta[]> {
  const filterMeta = (trials: TrialMeta[]) =>
    trials.filter((t) => t.filename.toLowerCase() !== "dataimport.csv");

  if (shouldUseSupabase()) {
    requireSupabaseConfigured("Remote trial listing");
    try {
      const remote = await listSupabaseTrials();
      if (remote.length > 0) return filterMeta(remote);
      if (dataSourceMode() === "remote") return filterMeta(remote);
      // Supabase connected but empty in auto mode — fall back to bundled/local CSV inventory
    } catch {
      if (dataSourceMode() === "remote") throw new Error("Failed to load trials from Supabase.");
      // fall through to local in auto mode
    }
  }
  return filterMeta(await syncLocalInventory());
}

async function getTrialById(id: string): Promise<TrialMeta | null> {
  if (shouldUseSupabase()) {
    requireSupabaseConfigured("Remote trial lookup");
    const sb = getSupabaseAdmin()!;
    const { data, error } = await sb
      .from("trials")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return rowToMeta(data as Record<string, unknown>);
  }

  const meta = await readLocalMeta();
  const trial = meta.trials.find((t) => t.id === id);
  if (!trial) return null;
  return {
    ...trial,
    plotLabel: trial.plotLabel ?? "",
    bookmarks: normalizeBookmarks(trial.bookmarks),
  };
}

async function writeTrialUpdate(
  id: string,
  patch: Partial<
    Pick<TrialMeta, "notes" | "sessionStartTime" | "label" | "plotLabel" | "bookmarks">
  >,
): Promise<TrialMeta | null> {
  if (shouldUseSupabase()) {
    requireSupabaseConfigured("Remote trial updates");
    const sb = getSupabaseAdmin()!;
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.notes !== undefined) payload.notes = patch.notes;
    if (patch.sessionStartTime !== undefined) {
      payload.session_start_time = patch.sessionStartTime;
    }
    if (patch.label !== undefined) payload.label = patch.label;
    if (patch.plotLabel !== undefined) payload.plot_label = patch.plotLabel;
    if (patch.bookmarks !== undefined) {
      payload.bookmarks = normalizeBookmarks(patch.bookmarks);
    }

    const { data, error } = await sb
      .from("trials")
      .update(payload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return rowToMeta(data as Record<string, unknown>);
  }

  requireWritableLocalData("Editing local trial metadata");
  const meta = await readLocalMeta();
  const idx = meta.trials.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const nextPatch = { ...patch };
  if (nextPatch.bookmarks !== undefined) {
    nextPatch.bookmarks = normalizeBookmarks(nextPatch.bookmarks);
  }
  meta.trials[idx] = {
    ...meta.trials[idx],
    bookmarks: meta.trials[idx].bookmarks ?? [],
    ...nextPatch,
    updatedAt: new Date().toISOString(),
  };
  await writeLocalMeta(meta);
  return meta.trials[idx];
}

/** Copy new session starts / bookmarks from A/B/C runs onto the same-day X run. */
async function mirrorBookmarksOntoXRun(
  source: TrialMeta,
  patch: Partial<
    Pick<TrialMeta, "notes" | "sessionStartTime" | "label" | "plotLabel" | "bookmarks">
  >,
): Promise<void> {
  const additions = collectMirroredBookmarks(
    source,
    patch,
    source.bookmarks ?? [],
  );
  if (!additions.length) return;

  const xTrial = findXRunTrial(await listTrials(), source);
  if (!xTrial) return;

  const merged = mergeMirroredBookmarks(xTrial.bookmarks ?? [], additions);
  if (!merged) return;

  await writeTrialUpdate(xTrial.id, { bookmarks: merged });
}

export async function updateTrial(
  id: string,
  patch: Partial<
    Pick<TrialMeta, "notes" | "sessionStartTime" | "label" | "plotLabel" | "bookmarks">
  >,
): Promise<TrialMeta | null> {
  const existing = await getTrialById(id);
  if (!existing) return null;

  const updated = await writeTrialUpdate(id, patch);
  if (!updated) return null;

  if (
    patch.sessionStartTime !== undefined ||
    patch.bookmarks !== undefined
  ) {
    await mirrorBookmarksOntoXRun(existing, patch);
  }

  return updated;
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

/**
 * Load series for plotting and attach computed X-run end bookmarks (replot only).
 */
export async function loadManySeriesForPlot(ids: string[]): Promise<TrialSeries[]> {
  const cache = new Map<string, TrialSeries | null>();
  const out: TrialSeries[] = [];

  for (const id of ids) {
    const s = await loadTrialSeries(id);
    cache.set(id, s);
    if (s) out.push(s);
  }

  const allTrials = await listTrials();
  const enriched: TrialSeries[] = [];

  for (const s of out) {
    const computed = await computeXRunDynamicEndBookmarks(
      s.meta,
      allTrials,
      async (id) => loadTrialSeries(id),
      cache,
    );
    enriched.push(
      computed.length ? { ...s, computedBookmarks: computed } : s,
    );
  }

  return enriched;
}

async function assertFilenameAvailable(filename: string) {
  const safeName = filename.replace(/[^\w.\-]+/g, "_");

  if (shouldUseSupabase()) {
    requireSupabaseConfigured("Remote CSV uploads");
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

  if (shouldUseSupabase()) {
    requireSupabaseConfigured("Remote CSV uploads");
    const sb = getSupabaseAdmin()!;
    const storagePath = `${Date.now()}_${safeName}`;
    const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, body, { contentType: "text/csv", upsert: false });
    if (upErr) {
      const msg = upErr.message;
      if (
        msg.includes("row-level security") &&
        !process.env.SUPABASE_SERVICE_ROLE_KEY
      ) {
        throw new Error(
          `${msg}. Add SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy, or run supabase/migrations/002_storage_policies.sql in the Supabase SQL Editor.`,
        );
      }
      throw new Error(msg);
    }

    const trial = newMeta(safeName, storagePath);
    const { data, error } = await sb
      .from("trials")
      .insert({
        id: trial.id,
        label: trial.label,
        filename: trial.filename,
        plot_label: trial.plotLabel,
        notes: trial.notes,
        session_start_time: trial.sessionStartTime,
        date_label: trial.dateLabel,
        storage_path: trial.storagePath,
        bookmarks: trial.bookmarks,
        uploaded_at: trial.uploadedAt,
        updated_at: trial.updatedAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return rowToMeta(data as Record<string, unknown>);
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
  if (shouldUseSupabase()) {
    requireSupabaseConfigured("Remote trial deletion");
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
