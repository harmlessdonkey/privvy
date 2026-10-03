import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { buildTables, DashboardSchema, evalMetrics, getPath, scopeState } from "../src/core/dashboard.js";
import { createRun, runDir, sealRun } from "../src/core/evidence.js";
import { Registry } from "../src/core/registry.js";
import type { Plugin } from "../src/core/types.js";
import { trackingVsConsent } from "../src/plugins/tracking-vs-consent/index.js";
import { tmpData } from "./helpers.js";

const NOW = new Date("2026-10-10T12:00:00Z");
const run = (status: "complete" | "failed", finishedAt: string) => ({ status, finishedAt });
const base = { running: false, now: NOW, staleAfterDays: 7 };

test("scope state: failed, awaiting review, issues by severity, inconclusive, clean, never, running", () => {
  const recent = "2026-10-09T12:00:00Z";
  assert.equal(scopeState({ ...base, run: null, result: null }).kind, "never");
  assert.equal(scopeState({ ...base, running: true, run: null, result: null }).kind, "running");
  assert.equal(scopeState({ ...base, run: run("failed", recent), result: null }).kind, "failed");
  assert.equal(scopeState({ ...base, run: run("complete", recent), result: null }).kind, "awaiting-review");
  const high = scopeState({ ...base, run: run("complete", recent), result: { outcome: "issues-proposed", items: [{ id: "a", title: "a", severity: "low", evidence: [] }, { id: "b", title: "b", severity: "high", evidence: [] }] } });
  assert.deepEqual([high.kind, high.severity], ["issues", "high"]);
  assert.equal(scopeState({ ...base, run: run("complete", recent), result: { outcome: "inconclusive", items: [] } }).kind, "inconclusive");
  assert.equal(scopeState({ ...base, run: run("complete", recent), result: { outcome: "no-issues", items: [] } }).kind, "no-issues");
});

test("a fresh scan is never shown as clean, and worst scopes sort first", () => {
  const recent = "2026-10-09T12:00:00Z";
  const awaiting = scopeState({ ...base, run: run("complete", recent), result: null });
  const clean = scopeState({ ...base, run: run("complete", recent), result: { outcome: "no-issues", items: [] } });
  const failed = scopeState({ ...base, run: run("failed", recent), result: null });
  const high = scopeState({ ...base, run: run("complete", recent), result: { outcome: "issues-proposed", items: [{ id: "a", title: "a", severity: "high", evidence: [] }] } });
  assert.ok(failed.rank < high.rank && high.rank < awaiting.rank && awaiting.rank < clean.rank);
});

test("overdue after the configured window, and it lifts a clean scope up the list", () => {
  const old = scopeState({ ...base, run: run("complete", "2026-10-02T11:00:00Z"), result: { outcome: "no-issues", items: [] } });
  assert.equal(old.overdue, true);
  assert.ok(old.rank < 8);
  const edge = scopeState({ ...base, staleAfterDays: 14, run: run("complete", "2026-10-02T11:00:00Z"), result: { outcome: "no-issues", items: [] } });
  assert.equal(edge.overdue, false);
});

test("metrics read dot paths in the result plugin block and warn above a threshold", () => {
  const plugin = { journeys: { "pre-interaction": { classified: { marketing: 3 } } }, consent_mode_signals: "present-denied" };
  assert.equal(getPath(plugin, "journeys.pre-interaction.classified.marketing"), 3);
  const m = evalMetrics(
    [
      { label: "Marketing", path: "journeys.pre-interaction.classified.marketing", warnAbove: 0 },
      { label: "Mode", path: "consent_mode_signals" },
      { label: "Missing", path: "nope.nothing" },
    ],
    plugin,
  );
  assert.deepEqual(m.map((x) => [x.value, x.warn]), [["3", true], ["present-denied", false], ["-", false]]);
  assert.equal(evalMetrics([{ label: "x", path: "a" }], undefined)[0]!.value, "-");
});

test("table widgets: per-journey tables, object rows, sorting, and unlisted files are never read", async () => {
  const data = await tmpData();
  const dir = runDir(data, "c1", "s1", "20261003T073612Z-abcdef");
  const { evidenceDir } = await createRun(dir);
  await mkdir(join(evidenceDir, "pre-interaction"), { recursive: true });
  await writeFile(join(evidenceDir, "pre-interaction", "cookies.yml"), "- {name: a, domain: x.com, expiresDays: 10}\n- {name: b, domain: y.com, expiresDays: 400}\n");
  await writeFile(join(evidenceDir, "pre-interaction", "local-storage.yml"), "https://x.com:\n  k1: {firstPartyStorage: true}\n  k2: {firstPartyStorage: false}\n");
  const scope = { id: "s1", label: "S", params: {} };
  const manifest = await sealRun(dir, {
    schemaVersion: 1, checkId: "c1", checkVersion: 1, scopeId: "s1", scope, pluginId: "p", pluginVersion: "1", runId: "20261003T073612Z-abcdef",
    startedAt: "2026-10-03T07:36:12.000Z", finishedAt: "2026-10-03T07:37:00.000Z", status: "complete", config: { revision: 1, sha256: "x", settings: {} }, log: [],
  });
  await writeFile(join(dir, "secret.yml"), "- {name: leaked}\n"); // outside evidence/, not in manifest

  const tables = await buildTables(
    { type: "table", title: "Cookies", file: "*/cookies.yml", sortBy: "-Days", limit: 200, columns: [{ label: "Name", field: "name" }, { label: "Days", field: "expiresDays" }] },
    dir, manifest,
  );
  assert.equal(tables.length, 1);
  assert.equal(tables[0]!.group, "pre-interaction");
  assert.deepEqual(tables[0]!.rows, [["b", "400"], ["a", "10"]]);

  const storage = await buildTables(
    { type: "table", title: "Storage", file: "*/local-storage.yml", fromObject: "nested", limit: 200, columns: [{ label: "Origin", field: "_group" }, { label: "Key", field: "_key" }] },
    dir, manifest,
  );
  assert.deepEqual(storage[0]!.rows, [["https://x.com", "k1"], ["https://x.com", "k2"]]);

  const none = await buildTables({ type: "table", title: "T", file: "../secret.yml", limit: 10, columns: [{ label: "Name", field: "name" }] }, dir, manifest);
  assert.deepEqual(none, []);
});

test("the cookies plugin declares a dashboard core can draw, and a bad declaration fails at startup", () => {
  assert.doesNotThrow(() => new Registry([trackingVsConsent]));
  const parsed = DashboardSchema.parse(trackingVsConsent.manifest.dashboard);
  assert.ok(parsed.tile.length > 0 && parsed.run.length > 0);
  const bad: Plugin = { ...trackingVsConsent, manifest: { ...trackingVsConsent.manifest, id: "bad", checks: [{ id: "bad-check", name: "x", description: "x", version: 1 }], dashboard: { run: [{ type: "table", title: "t", file: "f", columns: [] }] } } };
  assert.throws(() => new Registry([bad]), /invalid dashboard declaration/);
  const plain: Plugin = { ...bad, manifest: { ...bad.manifest, dashboard: undefined } };
  assert.deepEqual(new Registry([plain]).dashboard("bad"), { tile: [], history: [], run: [] });
});
