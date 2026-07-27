#!/usr/bin/env node
/**
 * Sync local data/csv/*.csv → Supabase Storage + trials table.
 *
 * Usage:
 *   npm run sync
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 *
 * Without Supabase env vars, this only refreshes data/metadata.json
 * for local-only mode (Next.js reads data/csv directly).
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const CSV_DIR = path.join(root, "data", "csv");
const META_PATH = path.join(root, "data", "metadata.json");
const BUCKET = "chamber-csvs";

function labelFromFilename(filename) {
  const m = filename.match(/^([^_]+)/);
  return m ? m[1] : filename.replace(/\.csv$/i, "");
}

function extractDateLabel(filename) {
  const m = filename.match(/_([0-9]{2})([0-9]{2})([0-9]{4})([A-Za-z]?)_/);
  if (!m) return null;
  const [, mm, dd, yyyy, run] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(d.getTime())) return null;
  const label = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return run ? `${label} (Run ${run.toUpperCase()})` : label;
}

async function ensureMeta() {
  await fs.mkdir(CSV_DIR, { recursive: true });
  try {
    await fs.access(META_PATH);
  } catch {
    await fs.writeFile(META_PATH, JSON.stringify({ trials: [] }, null, 2));
  }
}

async function syncLocalOnly() {
  await ensureMeta();
  const files = (await fs.readdir(CSV_DIR)).filter((f) =>
    f.toLowerCase().endsWith(".csv"),
  );
  const meta = JSON.parse(await fs.readFile(META_PATH, "utf8"));
  const byName = new Map(meta.trials.map((t) => [t.filename, t]));
  for (const file of files) {
    if (!byName.has(file)) {
      const now = new Date().toISOString();
      meta.trials.push({
        id: randomUUID(),
        label: labelFromFilename(file),
        filename: file,
        notes: "",
        sessionStartTime: null,
        dateLabel: extractDateLabel(file),
        storagePath: `local:${file}`,
        uploadedAt: now,
        updatedAt: now,
      });
    }
  }
  meta.trials = meta.trials.filter(
    (t) => !t.storagePath.startsWith("local:") || files.includes(t.filename),
  );
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2));
  console.log(`Local inventory: ${meta.trials.length} trial(s) in data/metadata.json`);
}

async function syncSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("No Supabase credentials — using local-only sync.");
    return syncLocalOnly();
  }

  await ensureMeta();
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const files = (await fs.readdir(CSV_DIR)).filter((f) =>
    f.toLowerCase().endsWith(".csv"),
  );

  const { data: existing, error } = await sb.from("trials").select("*");
  if (error) throw error;
  const byFilename = new Map((existing ?? []).map((r) => [r.filename, r]));

  for (const file of files) {
    const buf = await fs.readFile(path.join(CSV_DIR, file));
    const hash = createHash("sha1").update(buf).digest("hex").slice(0, 10);
    const storagePath = `${hash}_${file}`;

    if (byFilename.has(file)) {
      console.log(`skip (already registered): ${file}`);
      continue;
    }

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, buf, { contentType: "text/csv", upsert: false });
    if (upErr && !/already exists/i.test(upErr.message)) throw upErr;

    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      label: labelFromFilename(file),
      filename: file,
      notes: "",
      session_start_time: null,
      date_label: extractDateLabel(file),
      storage_path: storagePath,
      uploaded_at: now,
      updated_at: now,
    };
    const { error: insErr } = await sb.from("trials").insert(row);
    if (insErr) throw insErr;
    console.log(`uploaded: ${file} → ${storagePath}`);
  }

  console.log(`Done. Synced ${files.length} local CSV(s).`);
}

syncSupabase().catch((e) => {
  console.error(e);
  process.exit(1);
});
