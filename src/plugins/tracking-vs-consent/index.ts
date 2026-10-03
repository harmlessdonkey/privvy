import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CollectOutput, Plugin } from "../../core/types.js";

const run = promisify(execFile);

export const JOURNEYS = ["pre-interaction", "reject", "accept"] as const;
type Journey = (typeof JOURNEYS)[number];

/**
 * Check: which cookies, storage entries and third-party requests appear
 *  - before the visitor touches the consent banner (pre-interaction)
 *  - after Reject
 *  - after Accept
 * The cross-journey comparison ("reject was clicked but a tracker still fired") is why this is one check.
 *
 * STATUS: pre-interaction shells out to the EDPS Website Evidence Collector. Reject and accept need a
 * per-site banner recipe and are not implemented yet; the run records them as "not-implemented".
 *
 * The default collectorArgs match the collector's own CLI (`collect <url> --output <dir>`, checked against
 * `--help` for v4.5.0). Change them in the dashboard if your install differs.
 *
 * The collector leaves a scratch Chrome profile (`browser-profile/`, tens of MB of volatile files) in its
 * output folder. It is not evidence and would make the hashes unstable, so it is removed after each journey.
 */
const SCRATCH = ["browser-profile"];

const MAX_PAGES = 20;

/**
 * Extra collector arguments for visiting more than the landing page, all in the same browser session and
 * still without touching the consent banner.
 *  - `params.pages`: pages to visit, as absolute URLs or paths ("/en-gb/casino"). Same site as `params.url` only.
 *  - `settings.maxExtraPages`: additional pages the collector picks itself from links it finds (default 0).
 *  - `settings.sleepMs`: pause after each page load, so late scripts have time to fire.
 *  - `settings.seed`: makes the collector's random picks repeatable. Defaults to the scope id, so runs compare.
 */
export function crawlArgs(landing: string, params: Record<string, unknown>, settings: Record<string, unknown>, scopeId: string): { args: string[]; pages: string[] } {
  const base = new URL(landing);
  const bare = (h: string) => h.replace(/^www\./, "");
  const raw = params["pages"] ?? [];
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) throw new Error(`Scope "${scopeId}": params.pages must be a list of URLs or paths`);
  if (raw.length > MAX_PAGES) throw new Error(`Scope "${scopeId}": at most ${MAX_PAGES} pages`);
  const pages: string[] = [];
  for (const entry of raw as string[]) {
    let u: URL;
    try {
      u = new URL(entry.trim(), base);
    } catch {
      throw new Error(`Scope "${scopeId}": "${entry}" is not a valid URL or path`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Scope "${scopeId}": "${entry}" must be http(s)`);
    if (bare(u.hostname) !== bare(base.hostname)) throw new Error(`Scope "${scopeId}": "${entry}" is not on ${base.hostname}`);
    u.hash = "";
    const href = u.href;
    if (href !== base.href && !pages.includes(href)) pages.push(href);
  }
  const extra = Number(settings["maxExtraPages"] ?? 0);
  if (!Number.isInteger(extra) || extra < 0 || extra > MAX_PAGES) throw new Error(`maxExtraPages must be a whole number from 0 to ${MAX_PAGES}`);
  const args: string[] = [];
  for (const p of pages) args.push("--browse-link", p);
  if (pages.length + extra > 0) {
    args.push("--max", String(pages.length + extra));
    if (extra > 0) args.push("--seed", String(settings["seed"] ?? scopeId));
    if (settings["sleepMs"] !== undefined) args.push("--sleep", String(Number(settings["sleepMs"])));
  }
  return { args, pages };
}

export const trackingVsConsent: Plugin = {
  manifest: {
    id: "cookies",
    name: "Cookies and trackers",
    version: "0.1.0",
    description: "Collects evidence of cookies, storage and third-party requests before and after consent choices.",
    settingsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        collectorCommand: { type: "string", minLength: 1, description: "Executable that collects evidence" },
        collectorArgs: {
          type: "array",
          items: { type: "string" },
          description: "Arguments. {url} and {outDir} are replaced for each journey",
        },
        journeys: { type: "array", items: { enum: [...JOURNEYS] }, minItems: 1, uniqueItems: true },
        timeoutSeconds: { type: "integer", minimum: 30, maximum: 3600 },
        maxExtraPages: { type: "integer", minimum: 0, maximum: 20, description: "Extra pages the collector picks from links it finds, on top of scope pages" },
        sleepMs: { type: "integer", minimum: 0, maximum: 30000, description: "Pause after each page load" },
        seed: { type: "string", description: "Makes random page picks repeatable. Default: the scope id" },
      },
    },
    dashboard: {
      tile: [
        { label: "Marketing before choice", path: "journeys.pre-interaction.classified.marketing", warnAbove: 0 },
        { label: "Analytics before choice", path: "journeys.pre-interaction.classified.analytics", warnAbove: 0 },
        { label: "Third-party hosts", path: "journeys.pre-interaction.third_party_hosts" },
        { label: "Consent mode", path: "consent_mode_signals" },
      ],
      history: [
        { label: "Marketing", path: "journeys.pre-interaction.classified.marketing", warnAbove: 0 },
        { label: "Analytics", path: "journeys.pre-interaction.classified.analytics", warnAbove: 0 },
        { label: "Cookies", path: "journeys.pre-interaction.cookies_total" },
        { label: "Pages", path: "journeys.pre-interaction.pages_visited" },
      ],
      run: [
        {
          type: "stats",
          title: "Review summary",
          metrics: [
            { label: "Cookies", path: "journeys.pre-interaction.cookies_total" },
            { label: "Storage entries", path: "journeys.pre-interaction.storage_entries_total" },
            { label: "Pages visited", path: "journeys.pre-interaction.pages_visited" },
            { label: "Third-party hosts", path: "journeys.pre-interaction.third_party_hosts" },
            { label: "Marketing", path: "journeys.pre-interaction.classified.marketing", warnAbove: 0 },
            { label: "Analytics", path: "journeys.pre-interaction.classified.analytics", warnAbove: 0 },
            { label: "Consent platform", path: "consent_platform.vendor" },
            { label: "Consent mode", path: "consent_mode_signals" },
          ],
        },
        {
          type: "table",
          title: "Pages visited",
          file: "*/inspection.json",
          rows: "browsing_history",
          columns: [{ label: "URL", field: "_value" }],
        },
        {
          type: "table",
          title: "Cookies",
          file: "*/cookies.yml",
          sortBy: "-Days",
          columns: [
            { label: "Name", field: "name" },
            { label: "Domain", field: "domain" },
            { label: "Days", field: "expiresDays" },
            { label: "First party", field: "firstPartyStorage" },
            { label: "Secure", field: "secure" },
            { label: "HttpOnly", field: "httpOnly" },
            { label: "SameSite", field: "sameSite" },
          ],
        },
        {
          type: "table",
          title: "Local storage",
          file: "*/local-storage.yml",
          fromObject: "nested",
          columns: [
            { label: "Origin", field: "_group" },
            { label: "Key", field: "_key" },
            { label: "First party", field: "firstPartyStorage" },
          ],
        },
        {
          type: "table",
          title: "Tracker requests matched by filter lists",
          file: "*/beacons.yml",
          sortBy: "-Seen",
          columns: [
            { label: "URL", field: "url" },
            { label: "List", field: "listName" },
            { label: "Seen", field: "occurrences" },
          ],
        },
      ],
    },
    checks: [
      {
        id: "tracking-vs-consent",
        name: "Tracking technology vs consent choice",
        description: "What is placed before banner interaction, after reject, and after accept.",
        version: 1,
      },
    ],
  },

  starterConfig: {
    enabled: false,
    settings: {
      collectorCommand: "website-evidence-collector",
      collectorArgs: ["collect", "{url}", "--output", "{outDir}"],
      journeys: ["pre-interaction"],
      timeoutSeconds: 600,
    },
    checks: {
      "tracking-vs-consent": {
        enabled: false,
        schedule: null,
        staleAfterDays: 7,
        scopes: [{ id: "example.com--uk", label: "example.com (UK)", params: { url: "https://example.com", market: "uk" } }],
      },
    },
  },

  async collect(ctx): Promise<CollectOutput> {
    const url = String(ctx.scope.params["url"] ?? "");
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error(`Scope "${ctx.scope.id}" needs params.url to be an http(s) URL`);

    const command = String(ctx.settings["collectorCommand"] ?? "website-evidence-collector");
    const argTemplate = (ctx.settings["collectorArgs"] as string[] | undefined) ?? ["collect", "{url}", "--output", "{outDir}"];
    const journeys = (ctx.settings["journeys"] as Journey[] | undefined) ?? ["pre-interaction"];
    const timeoutMs = Number(ctx.settings["timeoutSeconds"] ?? 600) * 1000;

    const crawl = crawlArgs(url, ctx.scope.params, ctx.settings, ctx.scope.id);

    const status: Record<string, string> = {};
    for (const journey of journeys) {
      if (journey !== "pre-interaction") {
        status[journey] = "not-implemented";
        ctx.log(`journey ${journey}: not implemented yet, skipped`);
        await writeFile(
          join(ctx.evidenceDir, `${journey}.skipped.json`),
          JSON.stringify({ journey, reason: "not-implemented" }, null, 2) + "\n",
        );
        continue;
      }

      const outDir = join(ctx.evidenceDir, journey);
      const args = [...argTemplate.map((a) => a.replaceAll("{url}", url).replaceAll("{outDir}", outDir)), ...crawl.args];
      ctx.log(`journey ${journey}: ${command} ${args.join(" ")}`);
      await mkdir(ctx.evidenceDir, { recursive: true });

      // execFile, not a shell: the URL can never be interpreted as shell syntax.
      const cleanup = () => Promise.all(SCRATCH.map((name) => rm(join(outDir, name), { recursive: true, force: true })));
      const logPath = join(ctx.evidenceDir, `${journey}.collector.log`);
      try {
        const { stdout, stderr } = await run(command, args, { signal: ctx.signal, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
        await writeFile(logPath, `${stdout}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`);
        await cleanup();
        status[journey] = "collected";
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string };
        await writeFile(logPath, `${err.stdout ?? ""}\n--- stderr ---\n${err.stderr ?? err.message}`);
        await cleanup();
        status[journey] = "failed";
        throw new Error(`collector failed for journey ${journey}: ${err.message.split("\n")[0]}`);
      }
    }
    return { notes: { journeys: status, removedScratch: SCRATCH, command, args: argTemplate, crawl: { pages: crawl.pages, extraArgs: crawl.args }, market: ctx.scope.params["market"] ?? null } };
  },
};
