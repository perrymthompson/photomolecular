import { NextResponse } from "next/server";
import { listTrials } from "@/lib/trials";

export const runtime = "nodejs";

export async function GET() {
  try {
    const trials = await listTrials();
    return NextResponse.json(trials);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list trials" },
      { status: 500 },
    );
  }
}
