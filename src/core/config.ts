import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv } from "ajv";
import { assertSegment } from "./ids.js";
import { PluginConfigSchema, type Plugin, type StoredPluginConfig } from "./types.js";

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("; "));
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Instance configuration lives in the data volume, never in the repo.
 *   <data>/config/plugins/<pluginId>.json            current config
 *   <data>/config/history/<pluginId>/<revision>.json every saved revision
 */
export class ConfigStore {
  constructor(private readonly dataDir: string) {}

  private file(pluginId: string): string {
    assertSegment(pluginId, "plugin id");
    return join(this.dataDir, "config", "plugins", `${pluginId}.json`);
  }

  async get(pluginId: string): Promise<StoredPluginConfig> {
    try {
      return JSON.parse(await readFile(this.file(pluginId), "utf8")) as StoredPluginConfig;
    } catch {
      return { ...PluginConfigSchema.parse({}), revision: 0, updatedAt: new Date(0).toISOString() };
    }
  }

  async save(plugin: Plugin, input: unknown): Promise<StoredPluginConfig> {
    const parsed = PluginConfigSchema.safeParse(input);
    if (!parsed.success) {
      throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
    }
    const config = parsed.data;
    const problems: string[] = [];

    const validate = ajv.compile(plugin.manifest.settingsSchema);
    if (!validate(config.settings)) {
      for (const e of validate.errors ?? []) problems.push(`settings${e.instancePath}: ${e.message}`);
    }
    const known = new Set(plugin.manifest.checks.map((c) => c.id));
    for (const [checkId, check] of Object.entries(config.checks)) {
      if (!known.has(checkId)) problems.push(`checks.${checkId}: this plugin has no such check`);
      const seen = new Set<string>();
      for (const scope of check.scopes) {
        if (seen.has(scope.id)) problems.push(`checks.${checkId}: duplicate scope id "${scope.id}"`);
        seen.add(scope.id);
      }
    }
    if (problems.length) throw new ConfigError(problems);

    const current = await this.get(plugin.manifest.id);
    const stored: StoredPluginConfig = { ...config, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    const body = JSON.stringify(stored, null, 2) + "\n";

    const file = this.file(plugin.manifest.id);
    await mkdir(join(this.dataDir, "config", "plugins"), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, file);

    const historyDir = join(this.dataDir, "config", "history", plugin.manifest.id);
    await mkdir(historyDir, { recursive: true });
    await writeFile(join(historyDir, `${String(stored.revision).padStart(6, "0")}.json`), body, { mode: 0o600 });
    return stored;
  }
}
