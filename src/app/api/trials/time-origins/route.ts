import { NextResponse } from "next/server";
import { readTrialTimeOriginsFile } from "@/lib/trial-time-origins-store";

export const runtime = "nodejs";

/**
 * GET /api/trials/time-origins
 *
 * Returns persisted session / AH-trough / recording-start clocks
 * (written whenever Norm Rate stats are computed).
 */
export async function GET() {
  try {
    const file = await readTrialTimeOriginsFile();
    return NextResponse.json(file);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Failed to read time origins",
      },
      { status: 500 },
    );
  }
}
