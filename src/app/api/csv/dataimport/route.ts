import { NextResponse } from "next/server";
import { runDataImport } from "@/lib/import-dataimport";

export const runtime = "nodejs";

/** Apply metadata from data/csv/DataImport.csv onto matching trials. */
export async function POST() {
  try {
    const result = await runDataImport();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 },
    );
  }
}
