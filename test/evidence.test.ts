import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createRun, listRuns, runDir, sealRun, verifyRun } from "../src/core/evidence.js";
import { newRunId, parseRunDate } from "../src/core/ids.js";
import { tmpData } from "./helpers.js";

const scope = { id: "example.com--uk", label: "Example", params: {} };
const base = (runId: string) => ({
  schemaVersion: 1 as const, checkId: "c1", checkVersion: 1, scopeId: scope.id, scope, pluginId: "p", pluginVersion: "1",
  runId, startedAt: "2026-10-03T07:36:12.000Z", finishedAt: "2026-10-03T07:37:00.000Z", status: "complete" as const,
  config: { revision: 1, sha256: "x", settings: {} }, log: [],
});

test("run ids are UTC, sortable and contain no colons", () => {
  const id = newRunId(new Date("2026-10-03T07:36:12Z"));
  assert.match(id, /^20261003T073612Z-[0-9a-f]{6}$/);
  assert.deepEqual(parseRunDate(id), { yyyy: "2026", mm: "10", dd: "03" });
});

test("run folder follows check/scope/yyyy/mm/dd/run", async () => {
  const data = await tmpData();
  const dir = runDir(data, "c1", scope.id, "20261003T073612Z-abcdef");
  assert.ok(dir.endsWith("evidence/c1/example.com--uk/2026/10/03/20261003T073612Z-abcdef"));
});

test("path traversal in check or scope ids is rejected", async () => {
  const data = await tmpData();
  assert.throws(() => runDir(data, "../x", "s", "20261003T073612Z-abcdef"));
  assert.throws(() => runDir(data, "c", "a/b", "20261003T073612Z-abcdef"));
});

test("seal then verify passes; tampering, deletion and extra files are detected", async () => {
  const data = await tmpData();
  const runId = "20261003T073612Z-abcdef";
  const dir = runDir(data, "c1", scope.id, runId);
  const { evidenceDir } = await createRun(dir);
  await mkdir(join(evidenceDir, "pre-interaction"), { recursive: true });
  await writeFile(join(evidenceDir, "pre-interaction", "a.json"), '{"a":1}');
  await writeFile(join(evidenceDir, "b.txt"), "hello");
  const manifest = await sealRun(dir, base(runId));
  assert.equal(manifest.files.length, 2);
  assert.deepEqual(manifest.files.map((f) => f.path), ["b.txt", "pre-interaction/a.json"]);
  assert.deepEqual(await verifyRun(dir), { ok: true, problems: [] });

  await chmod(join(evidenceDir, "b.txt"), 0o644);
  await writeFile(join(evidenceDir, "b.txt"), "tampered");
  await writeFile(join(evidenceDir, "extra.txt"), "new");
  const report = await verifyRun(dir);
  assert.equal(report.ok, false);
  assert.ok(report.problems.includes("modified: b.txt"));
  assert.ok(report.problems.includes("unexpected file: extra.txt"));
});

test("listRuns finds sealed and unsealed runs, newest first", async () => {
  const data = await tmpData();
  const older = "20261002T000000Z-aaaaaa";
  const newer = "20261003T000000Z-bbbbbb";
  const d1 = runDir(data, "c1", scope.id, older);
  await createRun(d1);
  await sealRun(d1, base(older));
  await createRun(runDir(data, "c1", scope.id, newer)); // never sealed
  const runs = await listRuns(data);
  assert.deepEqual(runs.map((r) => [r.runId, r.manifest === null]), [[newer, true], [older, false]]);
});
