import type { CheckDefinition, Plugin } from "./types.js";

export class Registry {
  private readonly byId = new Map<string, Plugin>();
  private readonly checks = new Map<string, { plugin: Plugin; check: CheckDefinition }>();

  constructor(plugins: Plugin[]) {
    for (const plugin of plugins) {
      if (this.byId.has(plugin.manifest.id)) throw new Error(`Duplicate plugin id "${plugin.manifest.id}"`);
      this.byId.set(plugin.manifest.id, plugin);
      for (const check of plugin.manifest.checks) {
        // Evidence folders are keyed by check id, so check ids must be unique across all plugins.
        if (this.checks.has(check.id)) throw new Error(`Duplicate check id "${check.id}"`);
        this.checks.set(check.id, { plugin, check });
      }
    }
  }

  list(): Plugin[] {
    return [...this.byId.values()];
  }

  plugin(id: string): Plugin | undefined {
    return this.byId.get(id);
  }

  check(checkId: string): { plugin: Plugin; check: CheckDefinition } | undefined {
    return this.checks.get(checkId);
  }
}
