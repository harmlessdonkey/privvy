import { z } from "zod";

/** Ids that become folder names: lowercase, digits, dot, dash, underscore. No slashes. */
export const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export const ScopeSchema = z.object({
  id: z.string().regex(SEGMENT, "lowercase letters, digits, . _ - only"),
  label: z.string().min(1),
  /** Plugin-defined. For cookies: { url, market }. For email review: { campaignId }. */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type Scope = z.infer<typeof ScopeSchema>;

export const CheckConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Cron expression. Scheduling is not wired up yet; stored for when it is. */
  schedule: z.string().nullable().default(null),
  scopes: z.array(ScopeSchema).default([]),
});
export type CheckConfig = z.infer<typeof CheckConfigSchema>;

/** One plugin's configuration for this instance. Edited in the dashboard, stored in the data volume. */
export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(false),
  settings: z.record(z.string(), z.unknown()).default({}),
  checks: z.record(z.string(), CheckConfigSchema).default({}),
});
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

/** What is persisted: the config plus a revision counter managed by the store. */
export type StoredPluginConfig = PluginConfig & { revision: number; updatedAt: string };

export interface CheckDefinition {
  id: string;
  name: string;
  description: string;
  /** Bump when what the check collects or how it collects changes. Recorded in every manifest. */
  version: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** JSON Schema for `settings`. Used to validate input now and render forms later. */
  settingsSchema: Record<string, unknown>;
  checks: CheckDefinition[];
}

export interface CollectContext {
  runId: string;
  checkId: string;
  scope: Scope;
  settings: Record<string, unknown>;
  /** Write-once evidence goes here. Layout inside is the plugin's choice. */
  evidenceDir: string;
  signal: AbortSignal;
  log: (message: string) => void;
}

export interface CollectOutput {
  /** Free-form plugin notes stored in the manifest (tool versions, vantage point, ...). */
  notes?: Record<string, unknown>;
}

/** The only contract a plugin has to meet: given a scope, produce evidence files. */
export interface Plugin {
  manifest: PluginManifest;
  /** Shown in the dashboard editor the first time, so a new instance has something to edit. Generic values only. */
  starterConfig?: Record<string, unknown>;
  collect(ctx: CollectContext): Promise<CollectOutput | void>;
}

export interface FileEntry {
  /** Relative to the run's evidence/ directory, forward slashes. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface Manifest {
  schemaVersion: 1;
  checkId: string;
  checkVersion: number;
  scopeId: string;
  scope: Scope;
  pluginId: string;
  pluginVersion: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "complete" | "failed";
  error?: string;
  config: { revision: number; sha256: string; settings: Record<string, unknown> };
  files: FileEntry[];
  notes?: Record<string, unknown>;
  log: string[];
}
