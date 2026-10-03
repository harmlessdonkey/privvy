import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * A result is analysis written AFTER a run, by an agent or a person, as markdown with YAML front matter.
 * It is a proposal. Decisions about failures are made outside this tool.
 */
export const ResultFrontMatterSchema = z.object({
  schemaVersion: z.literal(1),
  checkId: z.string(),
  scopeId: z.string(),
  runId: z.string(),
  author: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  outcome: z.enum(["no-issues", "issues-proposed", "inconclusive"]),
  summary: z.string().min(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        severity: z.enum(["info", "low", "medium", "high"]),
        /** Paths relative to the run's evidence/ directory. */
        evidence: z.array(z.string()).default([]),
        detail: z.string().optional(),
      }),
    )
    .default([]),
  /** Plugin-defined payload, e.g. a per-journey summary for the cookies plugin. */
  plugin: z.record(z.string(), z.unknown()).optional(),
});
export type ResultFrontMatter = z.infer<typeof ResultFrontMatterSchema>;

export type ParsedResult =
  | { ok: true; file: string; frontMatter: ResultFrontMatter; body: string }
  | { ok: false; file: string; error: string };

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseResult(file: string, text: string, expect?: { checkId: string; scopeId: string; runId: string }): ParsedResult {
  const m = FRONT.exec(text);
  if (!m) return { ok: false, file, error: "no YAML front matter" };
  let raw: unknown;
  try {
    raw = parseYaml(m[1]!);
  } catch (e) {
    return { ok: false, file, error: `front matter is not valid YAML: ${(e as Error).message}` };
  }
  const parsed = ResultFrontMatterSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, file, error: msg };
  }
  const fm = parsed.data;
  if (expect && (fm.checkId !== expect.checkId || fm.scopeId !== expect.scopeId || fm.runId !== expect.runId)) {
    return { ok: false, file, error: "front matter check/scope/run does not match the folder it was found in" };
  }
  return { ok: true, file, frontMatter: fm, body: m[2]! };
}

/** Read every results/*.md for a run. Invalid files are returned (not hidden) so the dashboard can flag them. */
export async function listResults(runDirPath: string, expect?: { checkId: string; scopeId: string; runId: string }): Promise<ParsedResult[]> {
  const dir = join(runDirPath, "results");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: ParsedResult[] = [];
  for (const name of names) out.push(parseResult(name, await readFile(join(dir, name), "utf8"), expect));
  return out;
}
