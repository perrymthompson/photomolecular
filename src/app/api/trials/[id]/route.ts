import { NextResponse } from "next/server";
import { deleteTrial, updateTrial } from "@/lib/trials";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as {
      notes?: string;
      sessionStartTime?: string | null;
      label?: string;
      bookmarks?: { id?: string; time: string; note: string }[];
    };
    const patch: {
      notes?: string;
      sessionStartTime?: string | null;
      label?: string;
      bookmarks?: { id: string; time: string; note: string }[];
    } = {
      notes: body.notes,
      sessionStartTime: body.sessionStartTime,
      label: body.label,
    };
    if (body.bookmarks !== undefined) {
      patch.bookmarks = body.bookmarks.map((b) => ({
        id: b.id?.trim() || crypto.randomUUID(),
        time: b.time,
        note: b.note,
      }));
    }
    const updated = await updateTrial(id, patch);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const ok = await deleteTrial(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 },
    );
  }
}
