/**
 * Apply metadata from data/import/trial-metadata.csv onto matching ch1/ch2 trials.
 */
import { promises as fs } from "fs";
import path from "path";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  parseTrialMetadataRows,
  readTrialMetadataCsv,
} from "@/lib/trial-metadata-csv";

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

function normalizeStart(raw: unknown): string | null {
  const val = String(raw ?? "").trim();
  if (!val) return null;
  const m = val.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${pad2(m[1])}:${m[2]}:${m[3] ?? "00"}`;
}

export async function readPlannedUpdates(): Promise<{
  updatesByFilename: Map<string, DataImportUpdate>;
  badRows: number[];
  sourceLabel: string;
}> {
  const { csvText, source } = await readTrialMetadataCsv();
  const rows = parseTrialMetadataRows(csvText);
  const updatesByFilename = new Map<string, DataImportUpdate>();
  const badRows: number[] = [];

  rows.forEach((row, idx) => {
    const filename = String(row.filename ?? "").trim();
    const plotLabel = String(row.plot_label ?? "").trim();
    const sessionStartTime = normalizeStart(row.session_start);
    const notes = String(row.notes ?? "").trim();

    if (!filename.toLowerCase().endsWith(".csv")) {
      badRows.push(idx + 2);
      return;
    }

    updatesByFilename.set(filename, {
      filename,
      plotLabel,
      sessionStartTime,
      notes,
      rowNumber: idx + 2,
    });
  });

  return {
    updatesByFilename,
    badRows,
    sourceLabel: source === "storage" ? "trial-metadata.csv (storage)" : "trial-metadata.csv",
  };
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
  const { updatesByFilename, badRows, sourceLabel } =
    await readPlannedUpdates();
  const applied =
    (await applySupabase(updatesByFilename)) ??
    (await applyLocal(updatesByFilename));

  const parts = [
    `Source: ${sourceLabel}`,
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
