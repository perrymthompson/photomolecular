import { NextResponse } from "next/server";
import {
  readTrialMetadataCsv,
  writeTrialMetadataCsv,
} from "@/lib/trial-metadata-csv";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { csvText, source } = await readTrialMetadataCsv();
    return NextResponse.json({ ok: true, csvText, source });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to load" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { csvText?: string };
    if (typeof body.csvText !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing csvText" },
        { status: 400 },
      );
    }
    const { destination } = await writeTrialMetadataCsv(body.csvText);
    return NextResponse.json({ ok: true, destination });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to save" },
      { status: 500 },
    );
  }
}
