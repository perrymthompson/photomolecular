/** Plot-label helpers for Light / Dark condition tagging. */

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
