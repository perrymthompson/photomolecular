import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileP = promisify(execFile);

const IMPORT_FILE = path.join(process.cwd(), "data", "csv", "DataImport.csv");
const SCRIPT = path.join(process.cwd(), "scripts", "import-dataimport.mjs");

async function runImportScript(): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileP("node", [SCRIPT, "--apply"], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 10, // 10MB
  });
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

export async function GET() {
  try {
    const text = await fs.readFile(IMPORT_FILE, "utf8");
    return NextResponse.json({ csvText: text, ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to load DataImport.csv" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { csvText?: string };
    const csvText = body.csvText;
    if (typeof csvText !== "string") {
      return NextResponse.json({ ok: false, error: "Missing csvText" }, { status: 400 });
    }

    // Ensure the target file exists/gets updated before running the import script.
    await fs.mkdir(path.dirname(IMPORT_FILE), { recursive: true });
    await fs.writeFile(IMPORT_FILE, csvText, "utf8");

    const { stdout, stderr } = await runImportScript();
    return NextResponse.json({ ok: true, stdout, stderr });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 },
    );
  }
}

