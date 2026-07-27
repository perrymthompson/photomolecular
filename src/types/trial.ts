/** Trial / chamber CSV metadata and parsed sensor series. */

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
};

export type PlotMode = "calendar" | "aligned";

export type MetricKey = "absHumidity" | "rh" | "temp";

export const METRIC_LABELS: Record<MetricKey, string> = {
  absHumidity: "Absolute Humidity (g/m³)",
  rh: "Relative Humidity (%RH)",
  temp: "Temperature (°C)",
};
