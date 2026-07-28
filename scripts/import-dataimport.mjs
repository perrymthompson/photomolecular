#!/usr/bin/env node
/**
 * One-time metadata import from data/csv/DataImport.csv
 *
 * Maps rows to trial filename:
 *   Chamber + Date + Letter -> ch{1|2}_MMDDYYYY{A|B|C}_lau.csv
 *
 * Writes:
 *   - plot_label         ("Dark" or "Light, <Angle>")
 *   - session_start_time (HH:MM:SS)
 *   - notes              ("Notes A" + space + "Notes B")
 *
 * Usage:
 *   node scripts/import-dataimport.mjs          # dry run only
 *   node scripts/import-dataimport.mjs --apply  # apply updates
 */
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import Papa from "papaparse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const IMPORT_FILE = path.join(root, "data", "csv", "DataImport.csv");
const META_PATH = path.join(root, "data", "metadata.json");
const APPLY = process.argv.includes("--apply");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseDateToMmDdYyyy(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${pad2(mm)}${pad2(dd)}${yyyy}`;
}

function normalizeStart(raw) {
  const val = String(raw ?? "").trim();
  if (!val) return null;
  const m = val.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = pad2(m[1]);
  const mm = m[2];
  const ss = m[3] ?? "00";
  return `${hh}:${mm}:${ss}`;
}

function buildPlotLabel(illuminationRaw, angleRaw) {
  const illumination = String(illuminationRaw ?? "").trim();
  const angle = String(angleRaw ?? "").trim();
  if (!illumination) return "";
  if (/dark/i.test(illumination)) return "Dark";
  if (/light/i.test(illumination)) return angle ? `Light, ${angle}` : "Light";
  return illumination;
}

function combineNotes(aRaw, bRaw) {
  const a = String(aRaw ?? "").trim();
  const b = String(bRaw ?? "").trim();
  if (a && b) return `${a} ${b}`;
  return a || b;
}

function toFilenameKey(chamberRaw, dateRaw, letterRaw) {
  const chamber = String(chamberRaw ?? "").trim();
  const datePart = parseDateToMmDdYyyy(dateRaw);
  const letter = String(letterRaw ?? "").trim().toUpperCase();
  if (!/^[12]$/.test(chamber) || !datePart || !/^[A-C]$/.test(letter)) return null;
  return `ch${chamber}_${datePart}${letter}_lau.csv`;
}

function parseImportRows(csvText) {
  const parsed = Papa.parse(csvText, {
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

async function readPlannedUpdates() {
  const text = await fs.readFile(IMPORT_FILE, "utf8");
  const rows = parseImportRows(text);
  const updatesByFilename = new Map();
  const badRows = [];

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

function summarizeDiff(current, next) {
  return {
    plotLabel: current.plot_label !== next.plotLabel,
    sessionStartTime: (current.session_start_time ?? null) !== next.sessionStartTime,
    notes: (current.notes ?? "") !== next.notes,
  };
}

async function runSupabase(updatesByFilename) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb
    .from("trials")
    .select("id, filename, plot_label, session_start_time, notes");
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const matched = [];
  const unchanged = [];
  const missing = [];

  for (const [filename, next] of updatesByFilename.entries()) {
    const current = rows.find((r) => r.filename === filename);
    if (!current) {
      missing.push(filename);
      continue;
    }
    const diff = summarizeDiff(current, next);
    if (!diff.plotLabel && !diff.sessionStartTime && !diff.notes) {
      unchanged.push(filename);
      continue;
    }
    matched.push({ current, next, diff });
  }

  console.log(`Import rows mapped: ${updatesByFilename.size}`);
  console.log(`Matched trials: ${matched.length}`);
  console.log(`Unchanged trials: ${unchanged.length}`);
  console.log(`Missing trials: ${missing.length}`);
  if (missing.length) {
    console.log("Missing (first 8):", missing.slice(0, 8).join(", "));
  }

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write updates.");
    return true;
  }

  let updated = 0;
  for (const item of matched) {
    const { current, next } = item;
    const { error: upErr } = await sb
      .from("trials")
      .update({
        plot_label: next.plotLabel,
        session_start_time: next.sessionStartTime,
        notes: next.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id);
    if (upErr) throw new Error(`${current.filename}: ${upErr.message}`);
    updated += 1;
  }
  console.log(`Applied updates: ${updated}`);
  return true;
}

async function runLocalMeta(updatesByFilename) {
  const raw = await fs.readFile(META_PATH, "utf8");
  const meta = JSON.parse(raw);
  const trials = Array.isArray(meta.trials) ? meta.trials : [];
  const byFile = new Map(trials.map((t) => [t.filename, t]));

  const matched = [];
  const missing = [];
  for (const [filename, next] of updatesByFilename.entries()) {
    const current = byFile.get(filename);
    if (!current) {
      missing.push(filename);
      continue;
    }
    const curPlot = current.plotLabel ?? "";
    const curStart = current.sessionStartTime ?? null;
    const curNotes = current.notes ?? "";
    if (
      curPlot === next.plotLabel &&
      curStart === next.sessionStartTime &&
      curNotes === next.notes
    ) {
      continue;
    }
    matched.push({ current, next });
  }

  console.log(`Import rows mapped: ${updatesByFilename.size}`);
  console.log(`Matched local trials: ${matched.length}`);
  console.log(`Missing local trials: ${missing.length}`);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write updates.");
    return;
  }

  for (const { current, next } of matched) {
    current.plotLabel = next.plotLabel;
    current.sessionStartTime = next.sessionStartTime;
    current.notes = next.notes;
    current.updatedAt = new Date().toISOString();
  }
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  console.log(`Applied local updates: ${matched.length}`);
}

async function main() {
  const { updatesByFilename, badRows } = await readPlannedUpdates();
  if (badRows.length) {
    console.log(
      `Skipped ${badRows.length} row(s) with invalid Chamber/Date/Letter: ${badRows.join(", ")}`,
    );
  }
  const usedSupabase = await runSupabase(updatesByFilename);
  if (!usedSupabase) {
    console.log("No Supabase credentials found, updating local metadata.json instead.");
    await runLocalMeta(updatesByFilename);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

