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

  const rows = parsed.data.slice(1); // skip first row like R `skip = 1`
  const rhByTime = new Map<string, number>();
  const tempByTime = new Map<string, number>();

  for (const row of rows) {
    // Papa without header yields arrays; normalize
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

    // Normalize to ISO; treat logged clock as UTC (matches R tz="UTC")
    const time = timeStr.includes("T")
      ? new Date(timeStr).toISOString()
      : new Date(timeStr.replace(" ", "T") + "Z").toISOString();

    if (Number.isNaN(Date.parse(time))) continue;

    if (/RH/i.test(measureType)) rhByTime.set(time, value);
    else tempByTime.set(time, value);
  }

  const points: SensorPoint[] = [];
  for (const [time, rh] of rhByTime) {
    const temp = tempByTime.get(time);
    if (temp === undefined) continue;
    points.push({
      time,
      rh,
      temp,
      absHumidity: absoluteHumidity(rh, temp),
    });
  }

  points.sort((a, b) => a.time.localeCompare(b.time));
  return points;
}

/** Combine HH:MM[:SS] with the calendar date of the first sample. */
export function sessionStartIso(
  firstSampleIso: string | undefined,
  timeOfDay: string | null | undefined,
): string | null {
  if (!firstSampleIso || !timeOfDay?.trim()) return null;
  const date = firstSampleIso.slice(0, 10);
  const t = timeOfDay.trim();
  const full =
    t.length === 5 ? `${date}T${t}:00Z` : t.length === 8 ? `${date}T${t}Z` : null;
  if (!full) return null;
  const d = new Date(full);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
