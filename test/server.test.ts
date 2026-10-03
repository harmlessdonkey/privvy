import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import { LocalAuthProvider } from "../src/auth/local.js";
import { UserStore } from "../src/auth/users.js";
import { ConfigStore } from "../src/core/config.js";
import { listRuns } from "../src/core/evidence.js";
import { Registry } from "../src/core/registry.js";
import { Runner } from "../src/core/runner.js";
import { trackingVsConsent } from "../src/plugins/tracking-vs-consent/index.js";
import { buildApp } from "../src/server/app.js";
import { fakeCollector, tmpData } from "./helpers.js";

const PASSWORD = "correct horse battery";

async function boot() {
  const data = await tmpData();
  const users = new UserStore(data);
  await users.load();
  await users.create("admin", PASSWORD);
  const configs = new ConfigStore(data);
  const registry = new Registry([trackingVsConsent]);
  const runner = new Runner(data, registry, configs);
  const app = await buildApp({
    dataDir: data, registry, configs, runner, auth: new LocalAuthProvider(users),
    sessionSecret: "x".repeat(40), cookieSecure: false, setupNeeded: () => users.count === 0,
  });
  return { app, data, configs, runner };
}

class Browser {
  jar = new Map<string, string>();
  constructor(private app: Awaited<ReturnType<typeof boot>>["app"]) {}
  private store(res: LightMyRequestResponse) {
    for (const c of res.cookies) this.jar.set(c.name, c.value);
  }
  async req(method: "GET" | "POST", url: string, form?: Record<string, string>) {
    const res = await this.app.inject({
      method, url,
      headers: { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      ...(form ? { payload: new URLSearchParams(form).toString() } : {}),
    });
    this.store(res);
    return res;
  }
  csrf(res: LightMyRequestResponse): string {
    const m = /name="_csrf" value="([^"]+)"/.exec(res.body);
    assert.ok(m, "page has a csrf token");
    return m[1]!;
  }
  async login(password = PASSWORD) {
    const page = await this.req("GET", "/login");
    return this.req("POST", "/login", { username: "admin", password, _csrf: this.csrf(page) });
  }
}

test("everything except /login and /healthz needs a session", async () => {
  const { app } = await boot();
  for (const url of ["/", "/plugins/cookies", "/runs/a/b/20261003T073612Z-abcdef"]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 303, url);
    assert.equal(res.headers.location, "/login");
  }
  assert.equal((await app.inject({ url: "/healthz" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/plugins/cookies", payload: "config={}" , headers: { "content-type": "application/x-www-form-urlencoded" } })).statusCode, 303);
});

test("wrong password is refused, right password signs in, logout ends the session", async () => {
  const { app } = await boot();
  const b = new Browser(app);
  assert.equal((await b.login("wrong password!!")).statusCode, 401);
  assert.equal((await b.req("GET", "/")).statusCode, 303);

  const ok = await b.login();
  assert.equal(ok.statusCode, 303);
  const home = await b.req("GET", "/");
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /Overview/);
  assert.match(String(home.headers["cache-control"]), /no-store/);
  assert.match(String(home.headers["content-security-policy"]), /default-src 'self'/);

  const out = await b.req("POST", "/logout", { _csrf: b.csrf(home) });
  assert.equal(out.statusCode, 303);
  assert.equal((await b.req("GET", "/")).statusCode, 303);
});

test("POSTs without a CSRF token are rejected", async () => {
  const { app } = await boot();
  const b = new Browser(app);
  await b.login();
  assert.equal((await b.req("POST", "/logout", {})).statusCode, 403);
  assert.equal((await b.req("POST", "/plugins/cookies", { config: "{}" })).statusCode, 403);
  assert.equal((await b.req("POST", "/checks/tracking-vs-consent/run", {})).statusCode, 403);
});

test("login is rate limited", async () => {
  const { app } = await boot();
  const b = new Browser(app);
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await b.login("wrong password!!")).statusCode);
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
});

test("configure a plugin in the dashboard, run it, view the run, download evidence", async () => {
  const { app, data, configs, runner } = await boot();
  const script = await fakeCollector(data);
  const b = new Browser(app);
  await b.login();

  const form = await b.req("GET", "/plugins/cookies");
  assert.equal(form.statusCode, 200);
  assert.match(form.body, /example\.com--uk/); // starter config shown

  const bad = await b.req("POST", "/plugins/cookies", { _csrf: b.csrf(form), config: '{"settings":{"timeoutSeconds":1}}' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body, /Not saved/);

  const config = {
    enabled: true,
    settings: { collectorCommand: process.execPath, collectorArgs: [script, "{url}", "{outDir}"], journeys: ["pre-interaction"] },
    checks: { "tracking-vs-consent": { enabled: true, scopes: [{ id: "example.com--uk", label: "Example (UK)", params: { url: "https://example.com", market: "uk" } }] } },
  };
  const saved = await b.req("POST", "/plugins/cookies", { _csrf: b.csrf(await b.req("GET", "/plugins/cookies")), config: JSON.stringify(config) });
  assert.equal(saved.statusCode, 303);
  assert.equal((await configs.get("cookies")).revision, 1);

  const home = await b.req("GET", "/");
  const started = await b.req("POST", "/checks/tracking-vs-consent/run", { _csrf: b.csrf(home), scope: "example.com--uk" });
  assert.equal(started.statusCode, 303);
  for (let i = 0; i < 50 && !(await listRuns(data))[0]?.manifest; i++) await new Promise((r) => setTimeout(r, 100));
  const run = (await listRuns(data))[0]!;
  assert.equal(run.manifest?.status, "complete");

  // a finished scan with no analysis yet is awaiting review, never shown as clean
  const pending = await b.req("GET", "/");
  assert.match(pending.body, /Awaiting review/);
  assert.doesNotMatch(pending.body, /No issues/);

  // an analyst (agent or person) drops a result file next to the evidence
  await mkdir(join(run.dir, "results"), { recursive: true });
  await writeFile(join(run.dir, "results", "20261003T091500Z-agent.md"), `---
schemaVersion: 1
checkId: tracking-vs-consent
scopeId: example.com--uk
runId: ${run.runId}
author: agent
createdAt: "2026-10-03T09:15:00Z"
outcome: issues-proposed
summary: _ga set before interaction <script>alert(1)</script>
items:
  - { id: ga, title: _ga cookie, severity: high, evidence: [pre-interaction/inspection.json] }
---
body
`);
  const home2 = await b.req("GET", "/");
  assert.match(home2.body, /Issues proposed \(high\)/);
  assert.match(home2.body, /need attention/);
  assert.match(home2.body, /href="\/scopes\/tracking-vs-consent\/example\.com--uk"/);

  const hist = await b.req("GET", "/scopes/tracking-vs-consent/example.com--uk");
  assert.equal(hist.statusCode, 200);
  assert.match(hist.body, /Example \(UK\)/);
  assert.match(hist.body, new RegExp(`/runs/tracking-vs-consent/example\\.com--uk/${run.runId}`));
  assert.match(hist.body, /issues-proposed/);
  assert.match(hist.body, /top high/);
  assert.ok(!hist.body.includes("<script>alert(1)</script>"));
  assert.equal((await b.req("GET", "/scopes/tracking-vs-consent/nope")).statusCode, 404);
  assert.equal((await b.req("GET", "/scopes/..%2f/x")).statusCode, 404);

  const detail = await b.req("GET", `/runs/tracking-vs-consent/example.com--uk/${run.runId}?verify=1`);
  assert.equal(detail.statusCode, 200);
  assert.match(detail.body, /Integrity verified/);
  assert.ok(!detail.body.includes("<script>alert(1)</script>"), "result text is escaped");
  assert.match(detail.body, /&lt;script&gt;/);

  const base = `/runs/tracking-vs-consent/example.com--uk/${run.runId}/file`;
  const file = await b.req("GET", `${base}?path=${encodeURIComponent("pre-interaction/inspection.json")}`);
  assert.equal(file.statusCode, 200);
  assert.match(file.body, /_ga/);
  assert.match(String(file.headers["content-disposition"]), /attachment/);
  assert.equal((await b.req("GET", `${base}?path=${encodeURIComponent("../../manifest.json")}`)).statusCode, 404);
  assert.equal((await b.req("GET", `${base}?path=${encodeURIComponent("/etc/passwd")}`)).statusCode, 404);
  assert.equal((await b.req("GET", "/runs/..%2f/x/20261003T073612Z-abcdef")).statusCode, 404);
});
