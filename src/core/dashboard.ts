import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ResultFrontMatter } from "./results.js";
import type { Manifest } from "./types.js";

/**
 * A plugin describes how its reviews look on the dashboard. This is data, never markup: core knows how to
 * draw a small fixed set of widgets and plugins pick and configure them. A plugin that declares nothing
 * still gets the generic view (outcome, severity, findings, evidence files).
 */
export const MetricSchema = z.object({
  label: z.string().min(1),
  /** Dot path into the result's `plugin` block, e.g. `journeys.pre-interaction.classified.marketing`. */
  path: z.string().min(1),
  /** Appended to the value, e.g. " hosts". */
  suffix: z.string().optional(),
  /** Show as a warning when the value is a number above this. */
  warnAbove: z.number().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

export const ColumnSchema = z.object({
  label: z.string().min(1),
  /** Dot path into one row. `_key` and `_group` are set when rows come from an object. */
  field: z.string().min(1),
  suffix: z.string().optional(),
});

export const WidgetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stats"), title: z.string().optional(), metrics: z.array(MetricSchema).min(1).max(12) }),
  z.object({
    type: z.literal("table"),
    title: z.string().min(1),
    /** Evidence file relative to evidence/. A leading `*` segment repeats the table for each folder that has it. */
    file: z.string().min(1),
    /** Dot path to the rows inside the parsed file. Default: the file itself. */
    rows: z.string().optional(),
    /** When rows are an object of objects, turn each entry into a row (`_key`). With `nested`, go one level deeper (`_group`, `_key`). */
    fromObject: z.enum(["entries", "nested"]).optional(),
    columns: z.array(ColumnSchema).min(1).max(10),
    /** Sort by this column field, descending when it starts with `-`. */
    sortBy: z.string().optional(),
    limit: z.number().int().min(1).max(1000).default(200),
  }),
]);
export type Widget = z.infer<typeof WidgetSchema>;

export const DashboardSchema = z.object({
  /** Headline numbers on the scope's tile on the front page. */
  tile: z.array(MetricSchema).max(4).default([]),
  /** Extra columns per run on the scope history page. */
  history: z.array(MetricSchema).max(4).default([]),
  /** Sections on the run page, in order. */
  run: z.array(WidgetSchema).default([]),
});
export type Dashboard = z.infer<typeof DashboardSchema>;
export type DashboardInput = z.input<typeof DashboardSchema>;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export interface MetricValue { label: string; value: string; warn: boolean }

export function evalMetrics(metrics: Metric[], plugin: ResultFrontMatter["plugin"]): MetricValue[] {
  return metrics.map((m) => {
    const v = plugin ? getPath(plugin, m.path) : undefined;
    const shown = v === undefined || v === null ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return { label: m.label, value: shown === "-" ? shown : shown + (m.suffix ?? ""), warn: typeof v === "number" && m.warnAbove !== undefined && v > m.warnAbove };
  });
}

// ---- scope state: what the front page shows ----

export type StateKind = "running" | "never" | "failed" | "issues" | "inconclusive" | "awaiting-review" | "no-issues";
export type Severity = "info" | "low" | "medium" | "high";
const SEVERITY: Severity[] = ["info", "low", "medium", "high"];

export interface ScopeState {
  kind: StateKind;
  /** Highest severity among proposed items, when there are any. */
  severity: Severity | null;
  /** Latest run finished longer ago than the check's window. */
  overdue: boolean;
  /** Lower sorts first (needs attention soonest). */
  rank: number;
}

export function topSeverity(items: { severity: Severity }[]): Severity | null {
  let top = -1;
  for (const i of items) top = Math.max(top, SEVERITY.indexOf(i.severity));
  return top >= 0 ? SEVERITY[top]! : null;
}

export const DEFAULT_STALE_DAYS = 7;

export function scopeState(o: {
  running: boolean;
  run: Pick<Manifest, "status" | "finishedAt"> | null;
  result: Pick<ResultFrontMatter, "outcome" | "items"> | null;
  now: Date;
  staleAfterDays: number;
}): ScopeState {
  const { run, result } = o;
  if (o.running) return { kind: "running", severity: null, overdue: false, rank: 7 };
  if (!run) return { kind: "never", severity: null, overdue: false, rank: 6 };
  const ageMs = o.now.getTime() - Date.parse(run.finishedAt);
  const overdue = ageMs > o.staleAfterDays * 86_400_000;
  let state: ScopeState;
  if (run.status !== "complete") state = { kind: "failed", severity: null, overdue, rank: 0 };
  else if (!result) state = { kind: "awaiting-review", severity: null, overdue, rank: 5 };
  else if (result.outcome === "issues-proposed") {
    const severity = topSeverity(result.items);
    state = { kind: "issues", severity, overdue, rank: severity === "high" ? 1 : severity === "medium" ? 2 : 3 };
  } else if (result.outcome === "inconclusive") state = { kind: "inconclusive", severity: null, overdue, rank: 4 };
  else state = { kind: "no-issues", severity: null, overdue, rank: 8 };
  if (overdue && state.rank > 4.5) state.rank = 4.5;
  return state;
}

export function stateLabel(s: ScopeState): string {
  switch (s.kind) {
    case "failed": return "Run failed";
    case "issues": return s.severity ? `Issues proposed (${s.severity})` : "Issues proposed";
    case "inconclusive": return "Inconclusive";
    case "awaiting-review": return "Awaiting review";
    case "no-issues": return "No issues";
    case "never": return "Never run";
    case "running": return "Running";
  }
}

// ---- table widget data ----

export interface TableData { title: string; group: string | null; columns: string[]; rows: string[][]; total: number; note?: string }

const MAX_FILE_BYTES = 4_000_000;

async function loadEvidenceFile(runDir: string, rel: string): Promise<unknown> {
  const text = await readFile(join(runDir, "evidence", ...rel.split("/")), "utf8");
  return rel.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
}

function toRows(data: unknown, mode: "entries" | "nested" | undefined): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
  if (data === null || typeof data !== "object" || !mode) return [];
  const out: Record<string, unknown>[] = [];
  for (const [k1, v1] of Object.entries(data as Record<string, unknown>)) {
    if (mode === "entries") {
      if (v1 && typeof v1 === "object") out.push({ ...(v1 as object), _key: k1 });
    } else if (v1 && typeof v1 === "object") {
      for (const [k2, v2] of Object.entries(v1 as Record<string, unknown>)) {
        if (v2 && typeof v2 === "object") out.push({ ...(v2 as object), _key: k2, _group: k1 });
      }
    }
  }
  return out;
}

/** Resolve a table widget against a run's manifest-listed files. Never reads a file the manifest does not list. */
export async function buildTables(w: Extract<Widget, { type: "table" }>, runDir: string, manifest: Manifest): Promise<TableData[]> {
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  const targets: { path: string; group: string | null }[] = [];
  if (w.file.startsWith("*/")) {
    const tail = w.file.slice(2);
    for (const f of manifest.files) {
      const parts = f.path.split("/");
      if (parts.length >= 2 && parts.slice(1).join("/") === tail) targets.push({ path: f.path, group: parts[0]! });
    }
  } else if (listed.has(w.file)) targets.push({ path: w.file, group: null });

  const out: TableData[] = [];
  for (const t of targets) {
    const entry = listed.get(t.path)!;
    if (entry.bytes > MAX_FILE_BYTES) {
      out.push({ title: w.title, group: t.group, columns: [], rows: [], total: 0, note: `${t.path} is too large to show here; download it instead.` });
      continue;
    }
    try {
      const data = await loadEvidenceFile(runDir, t.path);
      const base = w.rows ? getPath(data, w.rows) : data;
      let rows = toRows(base, w.fromObject);
      if (w.sortBy) {
        const desc = w.sortBy.startsWith("-");
        const key = desc ? w.sortBy.slice(1) : w.sortBy;
        const col = w.columns.find((c) => c.label === key)?.field ?? key;
        rows = [...rows].sort((a, b) => {
          const x = getPath(a, col), y = getPath(b, col);
          const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
          return desc ? -c : c;
        });
      }
      out.push({
        title: w.title,
        group: t.group,
        columns: w.columns.map((c) => c.label),
        rows: rows.slice(0, w.limit).map((r) =>
          w.columns.map((c) => {
            const v = getPath(r, c.field);
            const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
            return s && c.suffix ? s + c.suffix : s;
          }),
        ),
        total: rows.length,
      });
    } catch (e) {
      out.push({ title: w.title, group: t.group, columns: [], rows: [], total: 0, note: `Could not read ${t.path}: ${(e as Error).message}` });
    }
  }
  return out;
}
