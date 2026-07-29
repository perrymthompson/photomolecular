/**
 * Apply metadata from data/csv/DataImport.csv onto matching ch1/ch2 trials.
 * Callable from the dashboard API (same idea as runCsvSync).
 *
 * Maps: Chamber + Date + Letter → ch{1|2}_MMDDYYYY{A|B|C}_lau.csv
 * Writes: plot_label, session_start_time, notes
 */
import { promises as fs } from "fs";
import path from "path";
import Papa from "papaparse";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

const IMPORT_FILE = path.join(process.cwd(), "data", "csv", "DataImport.csv");
const META_PATH = path.join(process.cwd(), "data", "metadata.json");

export type DataImportUpdate = {
  filename: string;
  plotLabel: string;
  sessionStartTime: string | null;
  notes: string;
  rowNumber: number;
};

export type DataImportResult = {
  mapped: number;
  updated: number;
  unchanged: number;
  missing: string[];
  badRows: number[];
  mode: "supabase" | "local";
  message: string;
};

function pad2(n: string | number): string {
  return String(n).padStart(2, "0");
}

function parseDateToMmDdYyyy(raw: unknown): string | null {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${pad2(mm)}${pad2(dd)}${yyyy}`;
}

function normalizeStart(raw: unknown): string | null {
  const val = String(raw ?? "").trim();
  if (!val) return null;
  const m = val.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${pad2(m[1])}:${m[2]}:${m[3] ?? "00"}`;
}

function buildPlotLabel(illuminationRaw: unknown, angleRaw: unknown): string {
  const illumination = String(illuminationRaw ?? "").trim();
  const angle = String(angleRaw ?? "").trim();
  if (!illumination) return "";
  if (/dark/i.test(illumination)) return "Dark";
  if (/light/i.test(illumination)) return angle ? `Light, ${angle}` : "Light";
  return illumination;
}

function combineNotes(aRaw: unknown, bRaw: unknown): string {
  const a = String(aRaw ?? "").trim();
  const b = String(bRaw ?? "").trim();
  if (a && b) return `${a} ${b}`;
  return a || b;
}

function toFilenameKey(
  chamberRaw: unknown,
  dateRaw: unknown,
  letterRaw: unknown,
): string | null {
  const chamber = String(chamberRaw ?? "").trim();
  const datePart = parseDateToMmDdYyyy(dateRaw);
  const letter = String(letterRaw ?? "").trim().toUpperCase();
  if (!/^[12]$/.test(chamber) || !datePart || !/^[A-C]$/.test(letter)) {
    return null;
  }
  return `ch${chamber}_${datePart}${letter}_lau.csv`;
}

function parseImportRows(csvText: string): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) {
    const msg = parsed.errors
      .slice(0, 3)
      .map((e) => `${e.code} at row ${e.row}: ${e.message}`)
      .join("; ");
    throw new Error(`DataImport.csv parse error: ${msg}`);
  }
  return parsed.data;
}

export async function readPlannedUpdates(): Promise<{
  updatesByFilename: Map<string, DataImportUpdate>;
  badRows: number[];
}> {
  const text = await fs.readFile(IMPORT_FILE, "utf8");
  const rows = parseImportRows(text);
  const updatesByFilename = new Map<string, DataImportUpdate>();
  const badRows: number[] = [];

  rows.forEach((row, idx) => {
    const filename = toFilenameKey(row["Chamber"], row["Date"], row["Letter"]);
    if (!filename) {
      badRows.push(idx + 2);
      return;
    }
    updatesByFilename.set(filename, {
      filename,
      plotLabel: buildPlotLabel(row["Illumination state"], row["Angle"]),
      sessionStartTime: normalizeStart(row["Start"]),
      notes: combineNotes(row["Notes A"], row["Notes B"]),
      rowNumber: idx + 2,
    });
  });

  return { updatesByFilename, badRows };
}

async function applySupabase(
  updatesByFilename: Map<string, DataImportUpdate>,
): Promise<Omit<DataImportResult, "badRows" | "message"> | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const { data, error } = await sb
    .from("trials")
    .select("id, filename, plot_label, session_start_time, notes");
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const missing: string[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const [filename, next] of updatesByFilename.entries()) {
    const current = rows.find((r) => r.filename === filename);
    if (!current) {
      missing.push(filename);
      continue;
    }

    const same =
      (current.plot_label ?? "") === next.plotLabel &&
      (current.session_start_time ?? null) === next.sessionStartTime &&
      (current.notes ?? "") === next.notes;

    if (same) {
      unchanged += 1;
      continue;
    }

    const { error: upErr } = await sb
      .from("trials")
      .update({
        plot_label: next.plotLabel,
        session_start_time: next.sessionStartTime,
        notes: next.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id);
    if (upErr) throw new Error(`${filename}: ${upErr.message}`);
    updated += 1;
  }

  return {
    mapped: updatesByFilename.size,
    updated,
    unchanged,
    missing,
    mode: "supabase",
  };
}

async function applyLocal(
  updatesByFilename: Map<string, DataImportUpdate>,
): Promise<Omit<DataImportResult, "badRows" | "message">> {
  const raw = await fs.readFile(META_PATH, "utf8");
  const meta = JSON.parse(raw) as { trials?: Array<Record<string, unknown>> };
  const trials = Array.isArray(meta.trials) ? meta.trials : [];
  const byFile = new Map(
    trials.map((t) => [String(t.filename ?? ""), t] as const),
  );

  const missing: string[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const [filename, next] of updatesByFilename.entries()) {
    const current = byFile.get(filename);
    if (!current) {
      missing.push(filename);
      continue;
    }

    const curPlot = String(current.plotLabel ?? "");
    const curStart =
      typeof current.sessionStartTime === "string"
        ? current.sessionStartTime
        : null;
    const curNotes = String(current.notes ?? "");

    if (
      curPlot === next.plotLabel &&
      curStart === next.sessionStartTime &&
      curNotes === next.notes
    ) {
      unchanged += 1;
      continue;
    }

    current.plotLabel = next.plotLabel;
    current.sessionStartTime = next.sessionStartTime;
    current.notes = next.notes;
    current.updatedAt = new Date().toISOString();
    updated += 1;
  }

  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");

  return {
    mapped: updatesByFilename.size,
    updated,
    unchanged,
    missing,
    mode: "local",
  };
}

export async function runDataImport(): Promise<DataImportResult> {
  const { updatesByFilename, badRows } = await readPlannedUpdates();
  const applied =
    (await applySupabase(updatesByFilename)) ??
    (await applyLocal(updatesByFilename));

  const parts = [
    `Mapped ${applied.mapped} row(s)`,
    `updated ${applied.updated}`,
    `unchanged ${applied.unchanged}`,
    `missing ${applied.missing.length}`,
  ];
  if (badRows.length) parts.push(`skipped ${badRows.length} invalid row(s)`);
  if (applied.missing.length) {
    parts.push(`(missing: ${applied.missing.slice(0, 8).join(", ")})`);
  }

  return {
    ...applied,
    badRows,
    message: parts.join(" · "),
  };
}
