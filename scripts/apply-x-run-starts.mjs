#!/usr/bin/env node
/**
 * One-time: read "X" run bookmarks (Trial A/B/C *start* only) and set
 * session_start_time on matching ch1/ch2 A/B/C trials on the same day.
 */
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseFilename(filename) {
  const m = filename.match(/^(ch[12])_(\d{8})([A-Za-z])_/);
  if (!m) return null;
  return { channel: m[1], date: m[2], run: m[3].toUpperCase() };
}

function normalizeTime(t) {
  const p = String(t).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(p)) return p;
  if (/^\d{2}:\d{2}$/.test(p)) return `${p}:00`;
  return p;
}

/** Trial letter → start time from bookmarks (start only, not end). */
function startTimesFromBookmarks(bookmarks) {
  const out = new Map();
  for (const b of bookmarks || []) {
    const note = (b.note || "").trim();
    if (!/start/i.test(note) || /end/i.test(note)) continue;
    const m = note.match(/Trial\s+([ABC])\b/i);
    if (!m) continue;
    out.set(m[1].toUpperCase(), normalizeTime(b.time));
  }
  return out;
}

const { data: trials, error } = await sb
  .from("trials")
  .select("id, filename, session_start_time, bookmarks");
if (error) throw error;

const byKey = new Map();
for (const t of trials) {
  const p = parseFilename(t.filename);
  if (!p) continue;
  byKey.set(`${p.channel}|${p.date}|${p.run}`, t);
}

const updates = [];
for (const t of trials) {
  const p = parseFilename(t.filename);
  if (!p || p.run !== "X") continue;
  const starts = startTimesFromBookmarks(t.bookmarks);
  for (const [runLetter, time] of starts) {
    const target = byKey.get(`${p.channel}|${p.date}|${runLetter}`);
    if (!target) {
      console.log(
        `skip: no ${p.channel} run ${runLetter} on ${p.date} (from ${t.filename})`,
      );
      continue;
    }
    updates.push({
      id: target.id,
      filename: target.filename,
      from: t.filename,
      runLetter,
      oldSession: target.session_start_time,
      newSession: time,
    });
  }
}

console.log(`Planned updates: ${updates.length}`);
for (const u of updates) {
  console.log(
    `  ${u.filename}: ${u.oldSession ?? "null"} → ${u.newSession}  (${u.from}, Trial ${u.runLetter} start)`,
  );
}

for (const u of updates) {
  const { error: upErr } = await sb
    .from("trials")
    .update({
      session_start_time: u.newSession,
      updated_at: new Date().toISOString(),
    })
    .eq("id", u.id);
  if (upErr) throw upErr;
}

console.log("Done.");
