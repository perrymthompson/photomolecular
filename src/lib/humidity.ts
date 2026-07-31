/**
 * =============================================================================
 * COMPUTATION MODULE: humidity.ts
 * Absolute humidity (AH) and vapor-pressure / VPD primitives
 * =============================================================================
 *
 * WHERE THIS FITS IN THE PIPELINE
 * -------------------------------
 * 1. CSV load (parse-csv.ts)
 *      RH_i [%], T_i [°C] at shared timestamps
 *      → calls absoluteHumidity(RH, T) ONCE per point
 *      → stores result on SensorPoint.absHumidity  [g/m³]
 *
 * 2. Derived metrics (derived-metrics.ts)
 *      Re-reads SensorPoint.absHumidity / .rh / .temp
 *      → AH trough detection, AH_rate = dAH/dt, VPD, Norm_Rate
 *      → VPD helpers below are used via vaporPressureDeficitKPa()
 *
 * 3. Plots (SensorPlot.tsx, EvapRateVsVpdPlot.tsx)
 *      Consume derived series; they do NOT recompute AH from RH/T.
 *
 * NOTE ON TWO DIFFERENT MAGNUS / TETENS PARAMETER SETS
 * ----------------------------------------------------
 * AH uses coefficients (6.112, 17.67, 243.5) matching the lab R script.
 * VPD uses Tetens form (0.61078, 17.27, 237.3) in kPa as specified for the
 * dashboard. These are intentionally DIFFERENT formulas — do not "unify"
 * them without checking against your analysis standard.
 *
 * VERIFY AH: pick one (RH, T) from a CSV and compare absoluteHumidity(RH, T)
 * to your R script for the same sample (expect floating-point agreement).
 * =============================================================================
 */

/**
 * Absolute humidity AH [g/m³] via Magnus–Tetens (R-script form).
 *
 * EQUATION
 * --------
 *   AH =
 *     ( 6.112 * exp( (17.67 * T) / (T + 243.5) ) * RH * 2.1674 )
 *     / (273.15 + T)
 *
 * where
 *   T  = dry-bulb temperature [°C]
 *   RH = relative humidity [%]  (0–100 scale, NOT 0–1)
 *
 * Physical reading of the pieces:
 *   6.112 * exp(...)     ≈ saturation vapor pressure e_s [hPa / mbar]
 *   * RH                 ≈ scales toward actual vapor pressure (RH still in %)
 *   * 2.1674 / (T+273.15) converts vapor-pressure × RH into mass concentration
 *
 * CALLED FROM: parse-csv.ts → SensorPoint.absHumidity
 * NOT called again when plotting AH rate — rate uses the stored absHumidity.
 */
export function absoluteHumidity(rh: number, tempC: number): number {
  return (
    (6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5)) * rh * 2.1674) /
    (273.15 + tempC)
  );
}

/**
 * Saturation vapor pressure Psat [kPa] — Tetens form for VPD.
 *
 * EQUATION
 * --------
 *   Psat = 0.61078 * exp( (17.27 * T) / (T + 237.3) )
 *
 * where T is temperature [°C].
 *
 * Units: kPa (NOT hPa). Do not mix with the 6.112 hPa term in absoluteHumidity.
 *
 * CALLED FROM: actualVaporPressureKPa, vaporPressureDeficitKPa
 */
export function saturationVaporPressureKPa(tempC: number): number {
  return 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/**
 * Actual vapor pressure Pa [kPa].
 *
 * EQUATION
 * --------
 *   Pa = Psat(T) * (RH / 100)
 *
 * RH is in percent; divide by 100 to get a fraction.
 */
export function actualVaporPressureKPa(rh: number, tempC: number): number {
  return saturationVaporPressureKPa(tempC) * (rh / 100);
}

/**
 * Vapor pressure deficit VPD [kPa].
 *
 * EQUATION
 * --------
 *   VPD = Psat(T) − Pa(RH, T)
 *       = Psat * (1 − RH/100)
 *
 * Implementation uses Psat − Psat*(RH/100) (algebraically identical).
 *
 * CALLED FROM: derived-metrics.ts → vpdSeries()
 * USED BY: EvapRateVsVpdPlot (x-axis), Norm Rate (denominator)
 */
export function vaporPressureDeficitKPa(rh: number, tempC: number): number {
  const psat = saturationVaporPressureKPa(tempC);
  return psat - psat * (rh / 100);
}

/** Extract "ch1" from "ch1_07242026A_lau.csv". (Metadata helper, not a sensor calc.) */
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
