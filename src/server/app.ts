import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import formbody from "@fastify/formbody";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import session from "@fastify/session";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { AuthProvider, AuthUser } from "../auth/provider.js";
import { ConfigError, type ConfigStore } from "../core/config.js";
import { listRuns, runDir, verifyRun } from "../core/evidence.js";
import { assertSegment, RUN_ID } from "../core/ids.js";
import type { Registry } from "../core/registry.js";
import { listResults } from "../core/results.js";
import type { Runner } from "../core/runner.js";
import type { Manifest } from "../core/types.js";
import { loginBody, overviewBody, pluginBody, runBody, scopeBody, type HistoryRow, type PluginView } from "./pages.js";
import { page, type Raw } from "./views.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export interface AppDeps {
  dataDir: string;
  registry: Registry;
  configs: ConfigStore;
  runner: Runner;
  auth: AuthProvider;
  sessionSecret: string;
  cookieSecure: boolean;
  /** True when no user exists yet, so the login page can say how to create one. */
  setupNeeded: () => boolean;
  logger?: boolean;
}

const PUBLIC_PATHS = new Set(["/login", "/healthz"]);

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: d.logger ?? false });

  await app.register(cookie);
  await app.register(session, {
    secret: d.sessionSecret,
    cookieName: "privvy.sid",
    cookie: { httpOnly: true, sameSite: "strict", secure: d.cookieSecure, path: "/", maxAge: 8 * 60 * 60 * 1000 },
  });
  await app.register(csrf, { sessionPlugin: "@fastify/session" });
  await app.register(formbody);
  await app.register(helmet);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const path = req.url.split("?")[0] ?? "/";
    if (PUBLIC_PATHS.has(path)) return;
    const user = await d.auth.currentUser(req);
    if (!user) return reply.redirect("/login", 303);
    req.user = user;
  });

  const flashOf = (req: FastifyRequest): string | undefined => {
    const f = req.session.flash;
    if (f) req.session.flash = undefined;
    return f;
  };
  const send = (req: FastifyRequest, reply: FastifyReply, title: string, body: (csrf: string) => Raw, status = 200) => {
    const csrfToken = reply.generateCsrf();
    return reply.code(status).type("text/html; charset=utf-8").send(page({ title, user: req.user, csrf: csrfToken, flash: flashOf(req), body: body(csrfToken) }));
  };

  app.get("/healthz", async () => "ok");

  // ---- auth ----
  app.get("/login", async (req, reply) => {
    if (await d.auth.currentUser(req)) return reply.redirect("/", 303);
    return send(req, reply, "Sign in", (csrf) => loginBody({ setupNeeded: d.setupNeeded(), csrf }));
  });

  app.post(
    "/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } }, preHandler: app.csrfProtection },
    async (req, reply) => {
      if (!d.auth.login) return reply.code(404).send("Password login is not enabled");
      const { username = "", password = "" } = (req.body ?? {}) as Record<string, string>;
      const user = await d.auth.login(req, String(username), String(password));
      if (!user) {
        req.session.flash = "Invalid username or password.";
        return send(req, reply, "Sign in", (csrf) => loginBody({ setupNeeded: d.setupNeeded(), csrf }), 401);
      }
      return reply.redirect("/", 303);
    },
  );

  app.post("/logout", { preHandler: app.csrfProtection }, async (req, reply) => {
    await d.auth.logout?.(req);
    return reply.redirect("/login", 303);
  });

  // ---- overview ----
  app.get("/", async (req, reply) => {
    const runs = await listRuns(d.dataDir);
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (!latest.has(`${r.checkId}/${r.scopeId}`)) latest.set(`${r.checkId}/${r.scopeId}`, r);

    const plugins: PluginView[] = [];
    for (const plugin of d.registry.list()) {
      const config = await d.configs.get(plugin.manifest.id);
      const checks = [];
      for (const def of plugin.manifest.checks) {
        const cc = config.checks[def.id];
        const scopes = [];
        for (const scope of cc?.scopes ?? []) {
          const run = latest.get(`${def.id}/${scope.id}`);
          let lastResult = null;
          if (run?.manifest) {
            const results = await listResults(run.dir, { checkId: def.id, scopeId: scope.id, runId: run.runId });
            const newest = results.filter((r) => r.ok).at(-1);
            if (newest?.ok) {
              const fm = newest.frontMatter;
              lastResult = { outcome: fm.outcome, summary: fm.summary, author: fm.author, items: fm.items.length };
            }
          }
          scopes.push({
            checkId: def.id,
            scopeId: scope.id,
            label: scope.label,
            running: d.runner.isRunning(def.id, scope.id),
            lastRun: run?.manifest ? { runId: run.runId, status: run.manifest.status, finishedAt: run.manifest.finishedAt } : null,
            lastResult,
          });
        }
        checks.push({ id: def.id, name: def.name, description: def.description, enabled: cc?.enabled ?? false, scopes });
      }
      plugins.push({ id: plugin.manifest.id, name: plugin.manifest.name, description: plugin.manifest.description, enabled: config.enabled, revision: config.revision, checks });
    }
    return send(req, reply, "Overview", (csrf) => overviewBody({ csrf, plugins }));
  });

  // ---- plugin configuration ----
  const pluginPage = async (req: FastifyRequest, reply: FastifyReply, id: string, text?: string, problems: string[] = []) => {
    const plugin = d.registry.plugin(id);
    if (!plugin) return reply.code(404).send("Unknown plugin");
    const stored = await d.configs.get(id);
    const isStarter = stored.revision === 0 && text === undefined;
    const { revision, updatedAt: _u, ...config } = stored;
    const shown = text ?? JSON.stringify(isStarter && plugin.starterConfig ? plugin.starterConfig : config, null, 2);
    return send(req, reply, plugin.manifest.name, (csrf) =>
      pluginBody({ csrf, id, name: plugin.manifest.name, revision, configText: shown, schemaText: JSON.stringify(plugin.manifest.settingsSchema, null, 2), problems, isStarter }),
      problems.length ? 400 : 200,
    );
  };

  app.get("/plugins/:id", async (req, reply) => pluginPage(req, reply, (req.params as { id: string }).id));

  app.post("/plugins/:id", { preHandler: app.csrfProtection }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const plugin = d.registry.plugin(id);
    if (!plugin) return reply.code(404).send("Unknown plugin");
    const text = String(((req.body ?? {}) as Record<string, string>)["config"] ?? "");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch (e) {
      return pluginPage(req, reply, id, text, [`Not valid JSON: ${(e as Error).message}`]);
    }
    try {
      const saved = await d.configs.save(plugin, input);
      req.session.flash = `Saved ${plugin.manifest.name} configuration (revision ${saved.revision}).`;
      return reply.redirect(`/plugins/${id}`, 303);
    } catch (e) {
      if (e instanceof ConfigError) return pluginPage(req, reply, id, text, e.problems);
      throw e;
    }
  });

  // ---- running checks ----
  app.post("/checks/:checkId/run", { preHandler: app.csrfProtection }, async (req, reply) => {
    const { checkId } = req.params as { checkId: string };
    const scope = String(((req.body ?? {}) as Record<string, string>)["scope"] ?? "") || undefined;
    try {
      const plan = await d.runner.plan(checkId, scope);
      // Runs take minutes (a real browser). Start in the background and return straight away.
      void d.runner.execute(plan).then(
        (o) => app.log.info({ checkId, outcomes: o }, "run finished"),
        (e) => app.log.error({ checkId, err: e }, "run crashed"),
      );
      req.session.flash = `Started ${checkId}${scope ? ` for ${scope}` : ""}. Refresh in a moment to see the run.`;
    } catch (e) {
      req.session.flash = `Could not start: ${(e as Error).message}`;
    }
    return reply.redirect("/", 303);
  });

  // ---- scope history ----
  const SEVERITY = ["info", "low", "medium", "high"] as const;
  app.get("/scopes/:checkId/:scopeId", async (req, reply) => {
    const { checkId, scopeId } = req.params as { checkId: string; scopeId: string };
    try {
      assertSegment(checkId, "check id");
      assertSegment(scopeId, "scope id");
    } catch {
      return reply.code(404).send("Scope not found");
    }
    const runs = await listRuns(d.dataDir, { checkId, scopeId });
    const plugin = d.registry.list().find((p) => p.manifest.checks.some((c) => c.id === checkId));
    const scopeCfg = plugin ? (await d.configs.get(plugin.manifest.id)).checks[checkId]?.scopes.find((s) => s.id === scopeId) : undefined;
    if (!scopeCfg && runs.length === 0) return reply.code(404).send("Scope not found");
    const rows: HistoryRow[] = [];
    for (const run of runs) {
      const m = run.manifest;
      const results = await listResults(run.dir, { checkId, scopeId, runId: run.runId });
      const valid = results.filter((r) => r.ok);
      const newest = valid.at(-1);
      let result: HistoryRow["result"] = null;
      if (newest?.ok) {
        const fm = newest.frontMatter;
        const top = fm.items.reduce<number>((acc, i) => Math.max(acc, SEVERITY.indexOf(i.severity)), -1);
        result = { outcome: fm.outcome, author: fm.author, items: fm.items.length, top: top >= 0 ? SEVERITY[top]! : null, summary: fm.summary };
      }
      rows.push({
        runId: run.runId,
        status: m?.status ?? "unfinished",
        startedAt: m?.startedAt ?? run.runId,
        durationSec: m ? Math.round((Date.parse(m.finishedAt) - Date.parse(m.startedAt)) / 1000) : null,
        configRevision: m?.config.revision ?? null,
        files: m?.files.length ?? 0,
        result,
        resultFiles: results.length,
      });
    }
    const label = scopeCfg?.label ?? runs.find((r) => r.manifest)?.manifest?.scope.label ?? scopeId;
    const rawUrl = scopeCfg?.params["url"];
    const url = typeof rawUrl === "string" ? rawUrl : null;
    return send(req, reply, label, (csrf) => scopeBody({ csrf, checkId, scopeId, label, url, running: d.runner.isRunning(checkId, scopeId), rows }));
  });

  // ---- run detail ----
  const locate = async (params: { checkId: string; scopeId: string; runId: string }) => {
    assertSegment(params.checkId, "check id");
    assertSegment(params.scopeId, "scope id");
    if (!RUN_ID.test(params.runId)) throw new Error("bad run id");
    const dir = runDir(d.dataDir, params.checkId, params.scopeId, params.runId);
    const manifest = (await listRuns(d.dataDir, { checkId: params.checkId, scopeId: params.scopeId })).find((r) => r.runId === params.runId)?.manifest;
    if (!manifest) throw new Error("run not found");
    return { dir, manifest };
  };

  app.get("/runs/:checkId/:scopeId/:runId", async (req, reply) => {
    const params = req.params as { checkId: string; scopeId: string; runId: string };
    let found: { dir: string; manifest: Manifest };
    try {
      found = await locate(params);
    } catch {
      return reply.code(404).send("Run not found");
    }
    const verify = (req.query as Record<string, string>)["verify"] === "1" ? await verifyRun(found.dir) : null;
    const results = await listResults(found.dir, params);
    return send(req, reply, found.manifest.scope.label, (csrf) => runBody({ csrf, manifest: found.manifest, results, verify }));
  });

  // Only files listed in the manifest can be downloaded: no arbitrary path access.
  app.get("/runs/:checkId/:scopeId/:runId/file", async (req, reply) => {
    const params = req.params as { checkId: string; scopeId: string; runId: string };
    const wanted = String((req.query as Record<string, string>)["path"] ?? "");
    let found: { dir: string; manifest: Manifest };
    try {
      found = await locate(params);
    } catch {
      return reply.code(404).send("Run not found");
    }
    const entry = found.manifest.files.find((f) => f.path === wanted);
    if (!entry) return reply.code(404).send("File not in manifest");
    const name = entry.path.split("/").at(-1) ?? "file";
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .send(createReadStream(join(found.dir, "evidence", ...entry.path.split("/"))));
  });

  return app;
}
