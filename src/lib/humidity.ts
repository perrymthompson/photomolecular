/**
 * =============================================================================
 * Absolute humidity + filename helpers (matches the lab R plotting script)
 * =============================================================================
 *
 * absoluteHumidity(rh, tempC) implements the Magnus–Tetens approximation:
 *
 *   AH (g/m³) =
 *     (6.112 * exp((17.67 * T) / (T + 243.5)) * RH * 2.1674) / (273.15 + T)
 *
 * where:
 *   T  = temperature in °C          (from CSV non-RH rows)
 *   RH = relative humidity in %     (from CSV rows whose measure type has "RH")
 *
 * Constants:
 *   6.112 / 17.67 / 243.5  — Magnus vapor-pressure coefficients
 *   2.1674                 — converts vapor pressure × RH into g/m³ scale
 *   273.15                 — °C → Kelvin in the denominator
 *
 * This is computed once per matched (RH, Temp) timestamp in parse-csv.ts and
 * stored on SensorPoint.absHumidity. SensorPlot then plots that field.
 *
 * VERIFY: pick a known (RH, Temp) pair from a CSV and compare AH to your R
 * script output for the same sample — they should match within floating error.
 * =============================================================================
 */

/**
 * Absolute humidity (g/m³) via Magnus–Tetens approximation
 * (same formula as the R plotting script).
 */
export function absoluteHumidity(rh: number, tempC: number): number {
  // Saturation vapor pressure (hPa) ≈ 6.112 * exp(…)
  // Then scale by RH and the 2.1674 / (T+273.15) factor → g/m³.
  return (
    (6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5)) * rh * 2.1674) /
    (273.15 + tempC)
  );
}

/** Extract "ch1" from "ch1_07242026A_lau.csv". */
export function labelFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "");
  const m = base.match(/^([^_]+)/);
  return m ? m[1] : base.replace(/\.csv$/i, "");
}

/**
 * Filename convention: ch1_07242026A_lau.csv
 * → "July 24, 2026 (Run A)"
 *
 * Pattern: _MMDDYYYY[RunLetter]_
 * Example: _07242026A_ → month=07, day=24, year=2026, run=A
 */
export function extractDateLabel(filename: string): string | null {
  const base = filename.replace(/^.*[\\/]/, "");
  const m = base.match(/_([0-9]{2})([0-9]{2})([0-9]{4})([A-Za-z]?)_/);
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

/** Channel number from label ("ch2" → 2); NaN if missing. */
export function channelNumber(label: string): number {
  const m = label.match(/^[Cc][Hh](\d+)/);
  return m ? Number(m[1]) : Number.NaN;
}
