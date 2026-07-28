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
};

export type TrialMeta = {
  id: string;
  /** Display label, usually filename prefix before first underscore (e.g. "ch1"). */
  label: string;
  filename: string;
  /** Free-text notes shown in plot subtitles (editable in dashboard). */
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

export type PlotMode = "calendar" | "aligned";

export type MetricKey = "absHumidity" | "rh" | "temp";

export const METRIC_LABELS: Record<MetricKey, string> = {
  absHumidity: "Absolute Humidity (g/m³)",
  rh: "Relative Humidity (%RH)",
  temp: "Temperature (°C)",
};
