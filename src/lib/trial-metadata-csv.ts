/**
 * Read/write data/import/trial-metadata.csv (or Supabase Storage copy when deployed).
 */
import { promises as fs } from "fs";
import path from "path";
import Papa from "papaparse";
import { BUCKET, getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

const IMPORT_FILE = path.join(process.cwd(), "data", "import", "trial-metadata.csv");
const IS_VERCEL = Boolean(process.env.VERCEL);
export const TRIAL_METADATA_STORAGE_KEY = "import/trial-metadata.csv";

export const TRIAL_METADATA_COLUMNS = [
  "filename",
  "date",
  "run",
  "chamber",
  "chamber_hardware",
  "session_start",
  "session_end",
  "plot_label",
  "notes",
] as const;

export function canWriteTrialMetadataCsv(): boolean {
  return !IS_VERCEL || isSupabaseConfigured();
}

async function readFromStorage(): Promise<string | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb.storage
    .from(BUCKET)
    .download(TRIAL_METADATA_STORAGE_KEY);
  if (error || !data) return null;
  return data.text();
}

async function writeToStorage(csvText: string): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    throw new Error("Supabase is not configured for remote metadata storage.");
  }
  const body = Buffer.from(csvText, "utf8");
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(TRIAL_METADATA_STORAGE_KEY, body, {
      contentType: "text/csv",
      upsert: true,
    });
  if (error) throw new Error(error.message);
}

export async function readTrialMetadataCsv(): Promise<{
  csvText: string;
  source: "storage" | "file";
}> {
  if (isSupabaseConfigured()) {
    const remote = await readFromStorage();
    if (remote) return { csvText: remote, source: "storage" };
  }

  try {
    const csvText = await fs.readFile(IMPORT_FILE, "utf8");
    return { csvText, source: "file" };
  } catch {
    throw new Error(
      `Could not find trial-metadata.csv at ${IMPORT_FILE}. Create data/import/trial-metadata.csv or run node scripts/build-trial-metadata.mjs.`,
    );
  }
}

export async function writeTrialMetadataCsv(csvText: string): Promise<{
  destination: "storage" | "file";
}> {
  if (IS_VERCEL) {
    if (!isSupabaseConfigured()) {
      throw new Error(
        "Saving trial-metadata.csv on Vercel requires Supabase storage. Configure Supabase env vars, or edit the file locally and redeploy.",
      );
    }
    await writeToStorage(csvText);
    return { destination: "storage" };
  }

  await fs.mkdir(path.dirname(IMPORT_FILE), { recursive: true });
  await fs.writeFile(IMPORT_FILE, csvText, "utf8");

  if (isSupabaseConfigured()) {
    try {
      await writeToStorage(csvText);
      return { destination: "storage" };
    } catch {
      return { destination: "file" };
    }
  }

  return { destination: "file" };
}

export function parseTrialMetadataRows(csvText: string): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) {
    const msg = parsed.errors
      .slice(0, 3)
      .map((e) => `${e.code} at row ${e.row}: ${e.message}`)
      .join("; ");
    throw new Error(`trial-metadata.csv parse error: ${msg}`);
  }
  return parsed.data;
}
