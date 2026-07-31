/**
 * =============================================================================
 * parseChamberCsv — turn a chamber CSV into SensorPoint[]
 * =============================================================================
 *
 * Expected CSV layout (same as the R script):
 *   V1 = id
 *   V2 = name
 *   V3 = channel
 *   V4 = measure type   ← contains "RH" for humidity rows; else treated as Temp
 *   V5 = value          ← numeric RH (%) or Temp (°C)
 *   V6 = timestamp      ← "YYYY-MM-DD HH:MM:SS" (treated as UTC, like R tz="UTC")
 *
 * Processing steps:
 *   1. PapaParse the text (no header row naming — columns are positional).
 *   2. Skip the first row (header / junk), matching R `skip = 1`.
 *   3. Split rows into two maps keyed by normalized ISO timestamp:
 *        rhByTime   — measure type matches /RH/i
 *        tempByTime — everything else with a valid numeric value
 *   4. For each timestamp that has BOTH rh and temp, emit a SensorPoint with:
 *        absHumidity = absoluteHumidity(rh, temp)   // humidity.ts
 *        ← ONLY place raw AH is computed from RH+T. Later dAH/dt / trough
 *          reuse SensorPoint.absHumidity (never recompute Magnus here).
 *   5. Sort points ascending by time.
 *
 * COMPUTATION HANDOFF (after this file returns SensorPoint[])
 *   humidity.ts         — AH, Psat, Pa, VPD primitives
 *   derived-metrics.ts  — trough t_start, AH_rate, VPD series, Norm_Rate
 *   EvapRateVsVpdPlot   — (VPD, AH_rate) scatter + OLS fits
 *   SensorPlot          — time-series of stored / derived metrics
 *
 * IMPORTANT: timestamps without a matching RH+Temp pair are dropped. If your
 * plot looks short, check that RH and Temp share identical clock strings.
 *
 * sessionStartIso() combines the first sample's calendar date (YYYY-MM-DD)
 * with a user-entered HH:MM[:SS] (session start or bookmark). Used for
 * dashed session markers, aligned-mode x=0, and AH trough floor.
 * =============================================================================
 */

import Papa from "papaparse";
import { absoluteHumidity } from "./humidity";
import type { SensorPoint } from "@/types/trial";

type RawRow = {
  id?: string;
  name?: string;
  channel?: string;
  measure_type?: string;
  value?: string;
  time?: string;
  V1?: string;
  V2?: string;
  V3?: string;
  V4?: string;
  V5?: string;
  V6?: string;
};

function cell(row: RawRow, named: keyof RawRow, indexed: keyof RawRow): string {
  const v = row[named] ?? row[indexed] ?? "";
  return String(v).trim();
}

/**
 * Parse chamber sensor CSV (R script format):
 * V1=id, V2=name, V3=channel, V4=measure type, V5=value, V6=timestamp
 * First row is skipped (header / junk). RH rows contain "RH" in measure type.
 */
export function parseChamberCsv(csvText: string): SensorPoint[] {
  const parsed = Papa.parse<RawRow>(csvText, {
    header: false,
    skipEmptyLines: true,
    quoteChar: '"',
  });

  // R script: skip = 1
  const rows = parsed.data.slice(1);
  const rhByTime = new Map<string, number>();
  const tempByTime = new Map<string, number>();

  for (const row of rows) {
    // Papa without header yields arrays; normalize to column indices 3/4/5.
    const arr = row as unknown as string[];
    const measureType = (
      Array.isArray(arr) ? String(arr[3] ?? "") : cell(row, "measure_type", "V4")
    ).trim();
    const valueStr = (
      Array.isArray(arr) ? String(arr[4] ?? "") : cell(row, "value", "V5")
    ).trim();
    const timeStr = (
      Array.isArray(arr) ? String(arr[5] ?? "") : cell(row, "time", "V6")
    ).trim();

    const value = Number(valueStr);
    if (!timeStr || Number.isNaN(value)) continue;

    // Normalize to ISO; treat logged clock as UTC (matches R tz="UTC").
    // "2026-07-24 12:38:00" → "2026-07-24T12:38:00.000Z"
    const time = timeStr.includes("T")
      ? new Date(timeStr).toISOString()
      : new Date(timeStr.replace(" ", "T") + "Z").toISOString();

    if (Number.isNaN(Date.parse(time))) continue;

    // RH vs Temp classification is purely by measure-type substring.
    if (/RH/i.test(measureType)) rhByTime.set(time, value);
    else tempByTime.set(time, value);
  }

  const points: SensorPoint[] = [];
  for (const [time, rh] of rhByTime) {
    const temp = tempByTime.get(time);
    if (temp === undefined) continue; // need both sensors at same clock time
    points.push({
      time,
      rh,
      temp,
      /**
       * Absolute humidity [g/m³] — Magnus–Tetens (R-script coefficients).
       * Formula: humidity.ts → absoluteHumidity(rh, temp)
       *   AH = (6.112 * exp((17.67*T)/(T+243.5)) * RH * 2.1674) / (273.15+T)
       * Downstream AH_rate / trough NEVER recompute this from RH/T; they
       * difference / smooth this stored field.
       */
      absHumidity: absoluteHumidity(rh, temp),
    });
  }

  points.sort((a, b) => a.time.localeCompare(b.time));
  return points;
}

/**
 * Combine HH:MM[:SS] with the calendar date of the first sample.
 * Example: firstSample="2026-07-24T10:00:00.000Z", timeOfDay="12:38:00"
 *       → "2026-07-24T12:38:00.000Z"
 */
export function sessionStartIso(
  firstSampleIso: string | undefined,
  timeOfDay: string | null | undefined,
): string | null {
  if (!firstSampleIso || !timeOfDay?.trim()) return null;
  const date = firstSampleIso.slice(0, 10); // YYYY-MM-DD
  const t = timeOfDay.trim();
  const full =
    t.length === 5 ? `${date}T${t}:00Z` : t.length === 8 ? `${date}T${t}Z` : null;
  if (!full) return null;
  const d = new Date(full);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
