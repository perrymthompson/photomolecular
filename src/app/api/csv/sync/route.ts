import { NextResponse } from "next/server";
import { runCsvSync } from "@/lib/sync-csv";

export const runtime = "nodejs";

/** Same as `npm run sync`: register new CSVs from data/csv/. */
export async function POST(req: Request) {
  try {
    let refresh = false;
    try {
      const body = (await req.json()) as { refresh?: boolean };
      refresh = Boolean(body.refresh);
    } catch {
      // empty body is fine
    }
    const result = await runCsvSync({ refresh });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 },
    );
  }
}
