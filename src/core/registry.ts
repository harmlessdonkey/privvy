import { DashboardSchema, type Dashboard } from "./dashboard.js";
import type { CheckDefinition, Plugin } from "./types.js";

export class Registry {
  private readonly byId = new Map<string, Plugin>();
  private readonly dashboards = new Map<string, Dashboard>();
  private readonly checks = new Map<string, { plugin: Plugin; check: CheckDefinition }>();

  constructor(plugins: Plugin[]) {
    for (const plugin of plugins) {
      if (this.byId.has(plugin.manifest.id)) throw new Error(`Duplicate plugin id "${plugin.manifest.id}"`);
      this.byId.set(plugin.manifest.id, plugin);
      // Fail at startup, not on page load, when a plugin declares a layout core cannot draw.
      const dash = DashboardSchema.safeParse(plugin.manifest.dashboard ?? {});
      if (!dash.success) throw new Error(`Plugin "${plugin.manifest.id}" has an invalid dashboard declaration: ${dash.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      this.dashboards.set(plugin.manifest.id, dash.data);
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

  /** The plugin's validated dashboard layout; empty (generic view) when it declared none. */
  dashboard(pluginId: string): Dashboard {
    return this.dashboards.get(pluginId) ?? DashboardSchema.parse({});
  }

  plugin(id: string): Plugin | undefined {
    return this.byId.get(id);
  }

  check(checkId: string): { plugin: Plugin; check: CheckDefinition } | undefined {
    return this.checks.get(checkId);
  }
}
