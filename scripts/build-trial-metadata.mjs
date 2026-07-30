#!/usr/bin/env node
/**
 * Build data/import/trial-metadata.csv from legacy data/csv/DataImport.csv
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Papa from "papaparse";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "data/csv/DataImport.csv");
const fallback = path.join(root, "data/import/trial-metadata.csv");
const outDir = path.join(root, "data/import");
const out = path.join(outDir, "trial-metadata.csv");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseDate(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { iso: "", block: "" };
  const [, mm, dd, yyyy] = m;
  return {
    iso: `${yyyy}-${pad2(mm)}-${pad2(dd)}`,
    block: `${pad2(mm)}${pad2(dd)}${yyyy}`,
  };
}

function normClock(raw) {
  const v = String(raw ?? "").trim();
  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  return `${pad2(m[1])}:${m[2]}:${m[3] ?? "00"}`;
}

function plotLabel(illum, angle) {
  const i = String(illum ?? "").trim();
  const a = String(angle ?? "").trim();
  if (!i) return "";
  if (/dark/i.test(i)) return "Dark";
  if (/light/i.test(i)) return a ? `Light, ${a}` : "Light";
  return i;
}

function combine(a, b) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (x && y) return `${x} ${y}`;
  return x || y;
}

const text = (() => {
  try {
    return readFileSync(src, "utf8");
  } catch {
    console.log("DataImport.csv not found; slimming existing trial-metadata.csv");
    const existing = readFileSync(fallback, "utf8");
    const rows = Papa.parse(existing, { header: true, skipEmptyLines: true }).data;
    mkdirSync(outDir, { recursive: true });
    const slim = rows.map((r) => ({
      filename: r.filename,
      date: r.date,
      run: r.run,
      chamber: r.chamber,
      chamber_hardware: r.chamber_hardware,
      session_start: r.session_start,
      session_end: r.session_end,
      plot_label: r.plot_label,
      notes: r.notes,
    }));
    writeFileSync(out, Papa.unparse(slim, { header: true }), "utf8");
    console.log(`Wrote ${slim.length} rows to ${out}`);
    process.exit(0);
  }
})();
const lines = text.trim().split(/\r?\n/);

/** Legacy layout: Chamber, hardware, Date, Start, End, Angle, … */
const COL = {
  chamber: 0,
  hardware: 1,
  date: 2,
  start: 3,
  end: 4,
  angle: 5,
  illumination: 6,
  notesA: 7,
  notesB: 8,
  run: 9,
};

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cols = Papa.parse(lines[i]).data[0];
  if (!cols?.length) continue;

  const chamber = String(cols[COL.chamber] ?? "").trim();
  const { iso, block } = parseDate(cols[COL.date]);
  const run = String(cols[COL.run] ?? "").trim().toUpperCase();

  rows.push({
    filename:
      chamber && block && run ? `ch${chamber}_${block}${run}_lau.csv` : "",
    date: iso,
    run,
    chamber,
    chamber_hardware: String(cols[COL.hardware] ?? "").trim(),
    session_start: normClock(cols[COL.start]),
    session_end: normClock(cols[COL.end]),
    plot_label: plotLabel(cols[COL.illumination], cols[COL.angle]),
    notes: combine(cols[COL.notesA], cols[COL.notesB]),
  });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(out, Papa.unparse(rows, { header: true }), "utf8");
console.log(`Wrote ${rows.length} rows to ${out}`);
