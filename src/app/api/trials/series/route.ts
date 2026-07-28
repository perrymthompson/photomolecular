import { NextResponse } from "next/server";
import { loadManySeriesForPlot } from "@/lib/trials";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { ids?: string[] };
    const ids = body.ids ?? [];
    if (ids.length > 30) {
      return NextResponse.json(
        { error: "Select at most 30 trials" },
        { status: 400 },
      );
    }
    const series = await loadManySeriesForPlot(ids);
    return NextResponse.json(series);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load series" },
      { status: 500 },
    );
  }
}
