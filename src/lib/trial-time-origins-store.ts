/**
 * Server-only persistence for trial time origins (AH trough, recording start).
 * Do not import from Client Components — use API routes instead.
 *
 * On Vercel the deploy filesystem is read-only (EROFS). We write to /tmp when
 * available, and never fail the stats API if persistence is impossible —
 * origins are still returned in the JSON response for the client.
 */

import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type {
  TrialTimeOrigins,
  TrialTimeOriginsFile,
} from "@/lib/trial-time-origins";

function originsPath(): string {
  // Lambda/Vercel: only /tmp is writable.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join("/tmp", "analysis-time-origins.json");
  }
  return path.join(process.cwd(), "data", "analysis-time-origins.json");
}

function emptyFile(): TrialTimeOriginsFile {
  return { version: 1, updatedAt: new Date().toISOString(), byTrialId: {} };
}

export async function readTrialTimeOriginsFile(): Promise<TrialTimeOriginsFile> {
  try {
    const raw = await fs.readFile(originsPath(), "utf8");
    const parsed = JSON.parse(raw) as TrialTimeOriginsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.byTrialId) {
      return emptyFile();
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      byTrialId: parsed.byTrialId,
    };
  } catch {
    return emptyFile();
  }
}

export async function writeTrialTimeOrigins(
  origins: TrialTimeOrigins[],
): Promise<TrialTimeOriginsFile> {
  const existing = await readTrialTimeOriginsFile();
  const byTrialId = { ...existing.byTrialId };
  for (const o of origins) {
    byTrialId[o.trialId] = o;
  }
  const next: TrialTimeOriginsFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    byTrialId,
  };

  try {
    const filePath = originsPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    // EROFS / permission errors must not break Norm Rate stats on Vercel.
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code !== "EROFS" && code !== "EACCES" && code !== "EPERM") {
      console.warn("[trial-time-origins-store] write failed:", err);
    }
  }

  return next;
}
