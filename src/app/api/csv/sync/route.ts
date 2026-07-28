import { NextResponse } from "next/server";
import { runCsvSync } from "@/lib/sync-csv";

export const runtime = "nodejs";

/** Same as `npm run sync`: register new CSVs from data/csv/. */
export async function POST() {
  try {
    const result = await runCsvSync();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 },
    );
  }
}
