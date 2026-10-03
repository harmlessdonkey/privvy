import { createRun, runDir, sealRun } from "./evidence.js";
import { ConfigStore, sha256Json } from "./config.js";
import { newRunId } from "./ids.js";
import type { Registry } from "./registry.js";
import type { Manifest, Scope } from "./types.js";

export interface RunOutcome {
  scopeId: string;
  runId: string;
  status: Manifest["status"];
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/** Runs a check for one scope or all of a check's scopes, one run folder each. */
export class Runner {
  private readonly active = new Set<string>();

  constructor(
    private readonly dataDir: string,
    private readonly registry: Registry,
    private readonly configs: ConfigStore,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  isRunning(checkId: string, scopeId: string): boolean {
    return this.active.has(`${checkId}/${scopeId}`);
  }

  /** Validate that a check can run now. Throws a readable error if not. Cheap, so callers can do it before going async. */
  async plan(checkId: string, only?: string): Promise<{ checkId: string; scopes: Scope[] }> {
    const found = this.registry.check(checkId);
    if (!found) throw new Error(`Unknown check "${checkId}"`);
    const config = await this.configs.get(found.plugin.manifest.id);
    if (!config.enabled) throw new Error(`Plugin "${found.plugin.manifest.id}" is not enabled`);
    const checkConfig = config.checks[checkId];
    if (!checkConfig?.enabled) throw new Error(`Check "${checkId}" is not enabled`);
    const scopes = checkConfig.scopes.filter((s) => !only || s.id === only);
    if (scopes.length === 0) throw new Error(only ? `Unknown scope "${only}"` : "Check has no scopes configured");
    return { checkId, scopes };
  }

  async execute(plan: { checkId: string; scopes: Scope[] }): Promise<RunOutcome[]> {
    const outcomes: RunOutcome[] = [];
    for (const scope of plan.scopes) outcomes.push(await this.runScope(plan.checkId, scope));
    return outcomes;
  }

  async runCheck(checkId: string, only?: string): Promise<RunOutcome[]> {
    return this.execute(await this.plan(checkId, only));
  }

  private async runScope(checkId: string, scope: Scope): Promise<RunOutcome> {
    const found = this.registry.check(checkId)!;
    const { plugin, check } = found;
    const key = `${checkId}/${scope.id}`;
    if (this.active.has(key)) return { scopeId: scope.id, runId: "", status: "failed", error: "already running" };
    this.active.add(key);

    const config = await this.configs.get(plugin.manifest.id);
    const startedAt = new Date();
    const runId = newRunId(startedAt);
    const dir = runDir(this.dataDir, checkId, scope.id, runId);
    const log: string[] = [];
    let status: Manifest["status"] = "complete";
    let error: string | undefined;
    let notes: Record<string, unknown> | undefined;

    try {
      const { evidenceDir } = await createRun(dir);
      const signal = AbortSignal.timeout(this.timeoutMs);
      const out = await plugin.collect({
        runId,
        checkId,
        scope,
        settings: config.settings,
        evidenceDir,
        signal,
        log: (m) => log.push(`${new Date().toISOString()} ${m}`),
      });
      notes = out?.notes;
    } catch (e) {
      status = "failed";
      error = (e as Error).message;
      log.push(`${new Date().toISOString()} FAILED: ${error}`);
    }

    try {
      await sealRun(dir, {
        schemaVersion: 1,
        checkId,
        checkVersion: check.version,
        scopeId: scope.id,
        scope,
        pluginId: plugin.manifest.id,
        pluginVersion: plugin.manifest.version,
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        status,
        ...(error ? { error } : {}),
        config: { revision: config.revision, sha256: sha256Json({ settings: config.settings, check: config.checks[checkId] }), settings: config.settings },
        ...(notes ? { notes } : {}),
        log,
      });
    } finally {
      this.active.delete(key);
    }
    return { scopeId: scope.id, runId, status, ...(error ? { error } : {}) };
  }
}
