import { NextResponse } from "next/server";
import {
  hasServiceRoleKey,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export const runtime = "nodejs";

/** Quick check: is Supabase wired up on this deployment? */
export async function GET() {
  return NextResponse.json({
    supabase: isSupabaseConfigured(),
    serviceRole: hasServiceRoleKey(),
    vercel: Boolean(process.env.VERCEL),
  });
}
