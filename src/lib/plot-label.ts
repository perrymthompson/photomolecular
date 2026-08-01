/**
 * =============================================================================
 * HELPERS: plot-label.ts (parsing, not sensor math)
 * =============================================================================
 * Maps free-text `plotLabel` / chamber id into analysis categories used by
 * norm-rate-run-stats.ts:
 *   Light / Dark condition, beam angle (45 / 90), hardware New/Old (ch1/ch2).
 * No floating-point sensor formulas here — classification only.
 * =============================================================================
 */

export type LightCondition = "light" | "dark";

/** Map plot labels like "Dark" / "Light, 45°" → light | dark. */
export function lightConditionFromPlotLabel(
  plotLabel: string | null | undefined,
): LightCondition | null {
  const s = (plotLabel ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "dark" || s.startsWith("dark")) return "dark";
  if (s.startsWith("light")) return "light";
  return null;
}

/**
 * Parse illumination angle from labels like "Light, 45°" / "Light, 90 deg".
 * Returns null for Dark or unlabeled Light.
 */
export function lightAngleFromPlotLabel(
  plotLabel: string | null | undefined,
): number | null {
  const s = (plotLabel ?? "").trim().toLowerCase();
  if (!s.startsWith("light")) return null;
  const m = s.match(/(\d+)\s*(?:°|deg)?/);
  if (!m) return null;
  const angle = Number(m[1]);
  return Number.isFinite(angle) ? angle : null;
}

/** ch1 → New, ch2 → Old (lab convention from trial-metadata). */
export function hardwareFromChamber(
  chamber: string | null | undefined,
): "New" | "Old" | null {
  const c = (chamber ?? "").trim().toLowerCase();
  if (c === "ch1") return "New";
  if (c === "ch2") return "Old";
  return null;
}
