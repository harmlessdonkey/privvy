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

async function setup(opts: { fail?: boolean; profile?: boolean } = {}) {
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

test("the collector's scratch Chrome profile is removed and never becomes evidence", async () => {
  const { data, runner } = await setup({ profile: true });
  await runner.runCheck("tracking-vs-consent");
  const m = (await listRuns(data))[0]!.manifest!;
  assert.ok(m.files.some((f) => f.path === "pre-interaction/inspection.json"));
  assert.ok(!m.files.some((f) => f.path.includes("browser-profile")));
  assert.deepEqual(m.notes?.["removedScratch"], ["browser-profile"]);
});

test("crawl arguments: scope pages become --browse-link, off-site and bad pages are refused", async () => {
  const { crawlArgs } = await import("../src/plugins/tracking-vs-consent/index.js");
  const landing = "https://www.example.com";
  const r = crawlArgs(landing, { pages: ["/casino", "https://example.com/sports#top", "/casino", "https://www.example.com/"] }, { maxExtraPages: 1, sleepMs: 2000 }, "ex");
  assert.deepEqual(r.pages, ["https://www.example.com/casino", "https://example.com/sports"]);
  assert.deepEqual(r.args, ["--browse-link", "https://www.example.com/casino", "--browse-link", "https://example.com/sports", "--max", "3", "--seed", "ex", "--sleep", "2000"]);
  assert.deepEqual(crawlArgs(landing, {}, {}, "ex").args, []);
  assert.throws(() => crawlArgs(landing, { pages: ["https://evil.example.net/x"] }, {}, "ex"), /is not on/);
  assert.throws(() => crawlArgs(landing, { pages: ["javascript:alert(1)"] }, {}, "ex"), /must be http/);
  assert.throws(() => crawlArgs(landing, { pages: "/a" }, {}, "ex"), /list of URLs/);
  assert.throws(() => crawlArgs(landing, { pages: Array.from({ length: 21 }, (_, i) => `/p${i}`) }, {}, "ex"), /at most 20/);
  assert.throws(() => crawlArgs(landing, {}, { maxExtraPages: 99 }, "ex"), /maxExtraPages/);
});

test("a run passes the crawl arguments to the collector and records them", async () => {
  const data = await tmpData();
  const script = await fakeCollector(data);
  const configs = new ConfigStore(data);
  const registry = new Registry([trackingVsConsent]);
  await configs.save(trackingVsConsent, {
    enabled: true,
    settings: { collectorCommand: process.execPath, collectorArgs: [script, "{url}", "{outDir}"], journeys: ["pre-interaction"] },
    checks: { "tracking-vs-consent": { enabled: true, scopes: [{ id: "ex", label: "Ex", params: { url: "https://example.com", pages: ["/casino"] } }] } },
  });
  const runner = new Runner(data, registry, configs);
  await runner.execute(await runner.plan("tracking-vs-consent", "ex"));
  const r = (await listRuns(data))[0]!;
  assert.equal(r.manifest?.status, "complete");
  const insp = JSON.parse(await readFile(join(r.dir, "evidence", "pre-interaction", "inspection.json"), "utf8"));
  assert.deepEqual(insp.extra, ["--browse-link", "https://example.com/casino", "--max", "1"]);
  assert.deepEqual((r.manifest!.notes as { crawl: { pages: string[] } }).crawl.pages, ["https://example.com/casino"]);
});
