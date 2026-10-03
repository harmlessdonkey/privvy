import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { assertSegment, parseRunDate, RUN_ID } from "./ids.js";
import type { FileEntry, Manifest } from "./types.js";

/**
 * Layout (the folder tree is the contract with the analysis layer):
 *
 *   <data>/evidence/<check>/<scope>/<yyyy>/<mm>/<dd>/<runId>/
 *       manifest.json     written last; hashes every file in evidence/
 *       evidence/         write-once, layout up to the plugin
 *       results/          added later by analysts (agents or people), never mixed with evidence
 */
export function runDir(dataDir: string, checkId: string, scopeId: string, runId: string): string {
  assertSegment(checkId, "check id");
  assertSegment(scopeId, "scope id");
  const { yyyy, mm, dd } = parseRunDate(runId);
  return join(dataDir, "evidence", checkId, scopeId, yyyy, mm, dd, runId);
}

export async function createRun(dir: string): Promise<{ evidenceDir: string; resultsDir: string }> {
  const evidenceDir = join(dir, "evidence");
  const resultsDir = join(dir, "results");
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });
  return { evidenceDir, resultsDir };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Files the operating system adds when someone browses a folder. They are not evidence. */
const OS_METADATA = /^(\.DS_Store|\._.*|Thumbs\.db|desktop\.ini)$/;

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (OS_METADATA.test(entry.name)) continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await visit(root);
  return out.sort();
}

export async function hashEvidence(evidenceDir: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  for (const full of await walk(evidenceDir)) {
    files.push({
      path: relative(evidenceDir, full).split(sep).join("/"),
      sha256: await sha256File(full),
      bytes: (await stat(full)).size,
    });
  }
  return files;
}

/** Hash everything in evidence/, write manifest.json, and make the files read-only. */
export async function sealRun(dir: string, manifest: Omit<Manifest, "files">): Promise<Manifest> {
  const evidenceDir = join(dir, "evidence");
  const files = await hashEvidence(evidenceDir);
  const full: Manifest = { ...manifest, files };
  const manifestPath = join(dir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(full, null, 2) + "\n", { mode: 0o444 });
  for (const f of files) await chmod(join(evidenceDir, ...f.path.split("/")), 0o444);
  await chmod(manifestPath, 0o444);
  return full;
}

export interface VerifyReport {
  ok: boolean;
  problems: string[];
}

/** Re-hash evidence/ and compare with the manifest. Detects edits, deletions and additions. */
export async function verifyRun(dir: string): Promise<VerifyReport> {
  const problems: string[] = [];
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifest;
  } catch {
    return { ok: false, problems: ["manifest.json missing or unreadable"] };
  }
  const actual = new Map((await hashEvidence(join(dir, "evidence"))).map((f) => [f.path, f]));
  for (const expected of manifest.files) {
    const got = actual.get(expected.path);
    if (!got) problems.push(`missing: ${expected.path}`);
    else if (got.sha256 !== expected.sha256) problems.push(`modified: ${expected.path}`);
    actual.delete(expected.path);
  }
  for (const extra of actual.keys()) problems.push(`unexpected file: ${extra}`);
  return { ok: problems.length === 0, problems };
}

export interface RunSummary {
  checkId: string;
  scopeId: string;
  runId: string;
  dir: string;
  manifest: Manifest | null;
}

async function dirs(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Scan the evidence tree. Newest first. `manifest` is null for runs that never finished. */
export async function listRuns(dataDir: string, filter: { checkId?: string; scopeId?: string } = {}): Promise<RunSummary[]> {
  const root = join(dataDir, "evidence");
  const runs: RunSummary[] = [];
  for (const checkId of await dirs(root)) {
    if (filter.checkId && filter.checkId !== checkId) continue;
    for (const scopeId of await dirs(join(root, checkId))) {
      if (filter.scopeId && filter.scopeId !== scopeId) continue;
      for (const yyyy of await dirs(join(root, checkId, scopeId))) {
        for (const mm of await dirs(join(root, checkId, scopeId, yyyy))) {
          for (const dd of await dirs(join(root, checkId, scopeId, yyyy, mm))) {
            const dayDir = join(root, checkId, scopeId, yyyy, mm, dd);
            for (const runId of await dirs(dayDir)) {
              if (!RUN_ID.test(runId)) continue;
              const dir = join(dayDir, runId);
              let manifest: Manifest | null = null;
              try {
                manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifest;
              } catch {
                /* run in progress or crashed before sealing */
              }
              runs.push({ checkId, scopeId, runId, dir, manifest });
            }
          }
        }
      }
    }
  }
  return runs.sort((a, b) => (a.runId < b.runId ? 1 : -1));
}
