/** Trial / chamber CSV metadata and parsed sensor series. */

/**
 * Time-stamped note on a trial (e.g. "06:00 — turned UV on").
 * `time` is clock time HH:MM or HH:MM:SS on the trial's data date —
 * same convention as sessionStartTime.
 */
export type TrialBookmark = {
  id: string;
  /** Clock time on the trial day: "HH:MM" or "HH:MM:SS" (24h). */
  time: string;
  /** Free-text note shown on hover over the plot marker. */
  note: string;
  /**
   * Optional absolute UTC instant for plotting (e.g. dynamic ends after midnight).
   * Not persisted to the database.
   */
  plotIso?: string;
};

export type TrialMeta = {
  id: string;
  /** Channel prefix from filename (e.g. "ch1", "amb"). */
  label: string;
  filename: string;
  /**
   * User-defined condition label for plots (e.g. "Dark", "Light, 45°").
   * Shown under the plot legend and in hover tooltips.
   */
  plotLabel: string;
  /** Free-text notes (editable on Dashboard and Plot page). */
  notes: string;
  /**
   * Session / exposure start as HH:MM:SS (24h) on the trial's data date.
   * Used for dashed markers and elapsed-time alignment.
   */
  sessionStartTime: string | null;
  /** ISO date string extracted from filename when available. */
  dateLabel: string | null;
  /** Storage path or local relative path to the CSV. */
  storagePath: string;
  /** Time-stamped event notes (bookmarks) shown as markers on the plot. */
  bookmarks: TrialBookmark[];
  uploadedAt: string;
  updatedAt: string;
};

export type SensorPoint = {
  time: string; // ISO
  rh: number;
  temp: number;
  absHumidity: number;
};

export type TrialSeries = {
  meta: TrialMeta;
  points: SensorPoint[];
  /**
   * Plot-only bookmarks (not persisted). e.g. dynamic "Trial A end" on X runs,
   * computed when series are loaded for replot.
   */
  computedBookmarks?: TrialBookmark[];
};

export type PlotMode = "calendar" | "aligned" | "trough";

/** Session-start or AH-trough modes use elapsed minutes on the x-axis. */
export function isElapsedPlotMode(mode: PlotMode): boolean {
  return mode === "aligned" || mode === "trough";
}

export type MetricKey =
  | "absHumidity"
  | "rh"
  | "temp"
  | "ahRate"
  | "vpd"
  | "normRate";

export const METRIC_LABELS: Record<MetricKey, string> = {
  absHumidity: "Absolute Humidity (g/m³)",
  rh: "Relative Humidity (%RH)",
  temp: "Temperature (°C)",
  ahRate: "AH Rate dAH/dt (g/m³/min)",
  vpd: "Vapor Pressure Deficit (kPa)",
  normRate: "Normalized Evaporation Rate ((g/m³/min)/kPa)",
};
