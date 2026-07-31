import { NextResponse } from "next/server";
import { computeNormRateRunStats } from "@/lib/norm-rate-run-stats";
import { listTrials, loadManySeries } from "@/lib/trials";
import { parseFilenameParts } from "@/lib/trial-sort";

export const runtime = "nodejs";

/**
 * GET /api/trials/norm-rate-stats
 *
 * Loads all non-X trials, pairs Light vs Dark within each day/run, and
 * returns Norm Rate Δ stats (same t-test as the plot Diff panel).
 */
export async function GET() {
  try {
    const trials = await listTrials();
    const excludedX = trials.filter(
      (t) => parseFilenameParts(t.filename).runLetter === "X",
    ).length;
    const nonX = trials.filter(
      (t) => parseFilenameParts(t.filename).runLetter !== "X",
    );
    const series = await loadManySeries(nonX.map((t) => t.id));
    const result = computeNormRateRunStats(series);
    result.summary.excludedX = excludedX;
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
