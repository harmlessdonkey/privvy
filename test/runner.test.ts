import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigError, ConfigStore } from "../src/core/config.js";
import { listRuns, verifyRun } from "../src/core/evidence.js";
import { Registry } from "../src/core/registry.js";
import { Runner } from "../src/core/runner.js";
import { trackingVsConsent } from "../src/plugins/tracking-vs-consent/index.js";
import { fakeCollector, tmpData } from "./helpers.js";

async function setup(opts: { fail?: boolean } = {}) {
  const data = await tmpData();
  const script = await fakeCollector(data, opts);
  const configs = new ConfigStore(data);
  const registry = new Registry([trackingVsConsent]);
  await configs.save(trackingVsConsent, {
    enabled: true,
    settings: { collectorCommand: process.execPath, collectorArgs: [script, "{url}", "{outDir}"], journeys: ["pre-interaction", "reject"] },
    checks: { "tracking-vs-consent": { enabled: true, scopes: [{ id: "example.com--uk", label: "Example (UK)", params: { url: "https://example.com", market: "uk" } }] } },
  });
  return { data, configs, runner: new Runner(data, registry, configs) };
}

test("config rejects bad settings, unknown checks and duplicate scopes", async () => {
  const data = await tmpData();
  const configs = new ConfigStore(data);
  await assert.rejects(configs.save(trackingVsConsent, { settings: { timeoutSeconds: 1 } }), ConfigError);
  await assert.rejects(configs.save(trackingVsConsent, { checks: { nope: {} } }), /no such check/);
  const dup = { id: "a", label: "A", params: {} };
  await assert.rejects(configs.save(trackingVsConsent, { checks: { "tracking-vs-consent": { scopes: [dup, dup] } } }), /duplicate scope/);
});

test("config revisions increment and every revision is kept", async () => {
  const { data, configs } = await setup();
  const second = await configs.save(trackingVsConsent, { enabled: false });
  assert.equal(second.revision, 2);
  assert.ok(await readFile(join(data, "config", "history", "cookies", "000001.json"), "utf8"));
  assert.ok(await readFile(join(data, "config", "history", "cookies", "000002.json"), "utf8"));
});

test("a run collects, seals, records the config it used, and verifies", async () => {
  const { data, runner } = await setup();
  const [outcome] = await runner.runCheck("tracking-vs-consent");
  assert.equal(outcome?.status, "complete");
  const [run] = await listRuns(data);
  const m = run!.manifest!;
  assert.equal(m.status, "complete");
  assert.equal(m.config.revision, 1);
  assert.ok(m.files.some((f) => f.path === "pre-interaction/inspection.json"));
  assert.ok(m.files.some((f) => f.path === "reject.skipped.json"));
  assert.deepEqual(m.notes?.["journeys"], { "pre-interaction": "collected", reject: "not-implemented" });
  assert.equal((await verifyRun(run!.dir)).ok, true);
});

test("a failing collector still produces a sealed, failed run with its log", async () => {
  const { data, runner } = await setup({ fail: true });
  const [outcome] = await runner.runCheck("tracking-vs-consent");
  assert.equal(outcome?.status, "failed");
  const m = (await listRuns(data))[0]!.manifest!;
  assert.equal(m.status, "failed");
  assert.match(m.error ?? "", /collector failed/);
  assert.ok(m.files.some((f) => f.path === "pre-interaction.collector.log"));
});

test("plan refuses disabled plugins and unknown scopes", async () => {
  const { configs, runner } = await setup();
  await assert.rejects(runner.plan("tracking-vs-consent", "nope"), /Unknown scope/);
  await configs.save(trackingVsConsent, { enabled: false });
  await assert.rejects(runner.plan("tracking-vs-consent"), /not enabled/);
});
