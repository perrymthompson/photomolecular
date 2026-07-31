import { NextResponse } from "next/server";
import { computeNormRateRunStats } from "@/lib/norm-rate-run-stats";
import {
  isNormRateAlignMode,
  writeTrialTimeOrigins,
  type NormRateAlignMode,
} from "@/lib/trial-time-origins";
import { listTrials, loadManySeries } from "@/lib/trials";
import { parseFilenameParts } from "@/lib/trial-sort";

export const runtime = "nodejs";

/**
 * GET /api/trials/norm-rate-stats?align=session|trough|clock
 *
 * Loads all non-X trials, persists AH-trough + recording-start origins, then
 * computes Norm Rate Δ stats on the chosen alignment grid.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("align") ?? "session";
    const alignMode: NormRateAlignMode = isNormRateAlignMode(raw)
      ? raw
      : "session";

    const trials = await listTrials();
    const excludedX = trials.filter(
      (t) => parseFilenameParts(t.filename).runLetter === "X",
    ).length;
    const nonX = trials.filter(
      (t) => parseFilenameParts(t.filename).runLetter !== "X",
    );
    const series = await loadManySeries(nonX.map((t) => t.id));
    const result = computeNormRateRunStats(series, alignMode);
    result.summary.excludedX = excludedX;

    // Persist trough + recording starts for future modules / replot.
    await writeTrialTimeOrigins(result.origins);

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Failed to compute Norm Rate stats",
      },
      { status: 500 },
    );
  }
}
