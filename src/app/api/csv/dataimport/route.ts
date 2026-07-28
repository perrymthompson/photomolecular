import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileP = promisify(execFile);

const SCRIPT = path.join(process.cwd(), "scripts", "import-dataimport.mjs");

async function runImportScript(): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileP("node", [SCRIPT, "--apply"], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 10, // 10MB
  });
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

export async function POST() {
  try {
    const { stdout, stderr } = await runImportScript();
    return NextResponse.json({ ok: true, stdout, stderr });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 },
    );
  }
}

