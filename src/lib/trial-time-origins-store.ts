/**
 * Server-only persistence for trial time origins (AH trough, recording start).
 * Do not import from Client Components — use API routes instead.
 */

import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type {
  TrialTimeOrigins,
  TrialTimeOriginsFile,
} from "@/lib/trial-time-origins";

const ORIGINS_PATH = path.join(
  process.cwd(),
  "data",
  "analysis-time-origins.json",
);

export async function readTrialTimeOriginsFile(): Promise<TrialTimeOriginsFile> {
  try {
    const raw = await fs.readFile(ORIGINS_PATH, "utf8");
    const parsed = JSON.parse(raw) as TrialTimeOriginsFile;
    if (!parsed || typeof parsed !== "object" || !parsed.byTrialId) {
      return { version: 1, updatedAt: new Date().toISOString(), byTrialId: {} };
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      byTrialId: parsed.byTrialId,
    };
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), byTrialId: {} };
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
  await fs.mkdir(path.dirname(ORIGINS_PATH), { recursive: true });
  await fs.writeFile(ORIGINS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}
