import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
 * The default collectorArgs below are a best guess. Confirm them with `website-evidence-collector --help`
 * on the machine or image that runs this, and change them in the dashboard if they differ.
 */
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
      },
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
      collectorArgs: ["{url}", "--output", "{outDir}"],
      journeys: ["pre-interaction"],
      timeoutSeconds: 600,
    },
    checks: {
      "tracking-vs-consent": {
        enabled: false,
        schedule: null,
        scopes: [{ id: "example.com--uk", label: "example.com (UK)", params: { url: "https://example.com", market: "uk" } }],
      },
    },
  },

  async collect(ctx): Promise<CollectOutput> {
    const url = String(ctx.scope.params["url"] ?? "");
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error(`Scope "${ctx.scope.id}" needs params.url to be an http(s) URL`);

    const command = String(ctx.settings["collectorCommand"] ?? "website-evidence-collector");
    const argTemplate = (ctx.settings["collectorArgs"] as string[] | undefined) ?? ["{url}", "--output", "{outDir}"];
    const journeys = (ctx.settings["journeys"] as Journey[] | undefined) ?? ["pre-interaction"];
    const timeoutMs = Number(ctx.settings["timeoutSeconds"] ?? 600) * 1000;

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
      const args = argTemplate.map((a) => a.replaceAll("{url}", url).replaceAll("{outDir}", outDir));
      ctx.log(`journey ${journey}: ${command} ${args.join(" ")}`);
      await mkdir(ctx.evidenceDir, { recursive: true });

      // execFile, not a shell: the URL can never be interpreted as shell syntax.
      const logPath = join(ctx.evidenceDir, `${journey}.collector.log`);
      try {
        const { stdout, stderr } = await run(command, args, { signal: ctx.signal, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
        await writeFile(logPath, `${stdout}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`);
        status[journey] = "collected";
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string };
        await writeFile(logPath, `${err.stdout ?? ""}\n--- stderr ---\n${err.stderr ?? err.message}`);
        status[journey] = "failed";
        throw new Error(`collector failed for journey ${journey}: ${err.message.split("\n")[0]}`);
      }
    }
    return { notes: { journeys: status, command, args: argTemplate, market: ctx.scope.params["market"] ?? null } };
  },
};
