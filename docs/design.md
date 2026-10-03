# privvy design

Status: first scaffold. Decisions below were agreed in conversation; the "Not built yet" section is honest about what is missing.

## Purpose

A privacy monitoring tool with a dashboard. Plugins collect evidence about something (the first one: which cookies and trackers a site places before and after a visitor's consent choice). A separate layer, an agent or a person, analyses that evidence and writes results. The dashboard controls the plugins and shows evidence and results.

## Principles

1. **Evidence and decisions are separate.** The tool collects and stores evidence. It never records a verdict. Results are proposals; what to do about a failure is decided outside the tool.
2. **The folder tree is the contract.** Plugins write evidence to a known place; analysts drop result files in a known place; the dashboard reads both. Anything that can read and write files can take part.
3. **Evidence is write-once.** Every run is sealed with SHA-256 hashes and made read-only. Analysis is added alongside it, never mixed in.
4. **Config belongs to the instance, not the repo.** Targets, schedules, settings and rules are entered in the dashboard and stored in the data volume. The repo holds code, schemas and generic examples only.
5. **Plugins are not web-specific.** A plugin turns a scope into evidence files. Later plugins will read mailboxes, ROPA exports or vendor lists.
6. **Files are the source of truth.** Any index or cache must be rebuildable by rescanning `data/`.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Plugin | A unit of functionality with its own settings. Example: "Cookies and trackers". |
| Check | A question a plugin answers, versioned. Example: "Tracking technology vs consent choice". |
| Scope | What a check is applied to. A site and market, an email campaign, a vendor. Plugin-defined. |
| Run | One execution of a check for one scope at one time. |
| Evidence | The write-once files a run produces. Layout inside is up to the plugin. |
| Result | Analysis of a run, written later, as markdown with YAML front matter. |

"Journey" (no interaction, reject, accept) is not a core term. It is just how the cookies plugin organises its own evidence.

## Data directory

Everything instance-specific is under one volume (`PRIVVY_DATA_DIR`, `/data` in Docker). Git ignores it.

```
data/
  evidence/<check>/<scope>/<yyyy>/<mm>/<dd>/<runId>/
    manifest.json        written last; hashes every file in evidence/
    evidence/            write-once; layout is the plugin's choice
    results/             analysis added later; never mixed with evidence
  config/
    plugins/<plugin>.json          current configuration
    history/<plugin>/<rev>.json    every saved revision
    users.json                     argon2id password hashes, mode 0600
    .session-key                   generated session secret, mode 0600
```

- Ids used in paths (check, scope) are lowercase letters, digits, `.`, `_`, `-`. No slashes, so paths cannot escape.
- Run ids are UTC and sortable with no colons (safe on SMB shares and Windows): `20261003T073612Z-a1b2c3`.
- The cookies plugin writes `evidence/pre-interaction/`, `evidence/reject/`, `evidence/accept/` plus collector logs.

## Manifest

Written when a run finishes (complete or failed). Records the check and its version, the full scope, plugin and version, timings, status and error, the **configuration revision and hash that produced the run** (and the settings themselves), a SHA-256 and size for every evidence file, plugin notes, and the run log. `verifyRun` re-hashes the folder and reports modified, missing and unexpected files.

## Results

Markdown files in a run's `results/` folder. Front matter (validated with zod, see `src/core/results.ts`):

```yaml
---
schemaVersion: 1
checkId: tracking-vs-consent
scopeId: betvictor.com--uk
runId: 20261003T073612Z-a1b2c3     # must match the folder it is in
author: agent
createdAt: "2026-10-03T09:15:00Z"
outcome: issues-proposed           # no-issues | issues-proposed | inconclusive
summary: One line a person can scan.
items:
  - id: ga-before-consent
    title: Analytics cookie set before interaction
    severity: high                 # info | low | medium | high
    evidence: [pre-interaction/inspection.json]
plugin: {}                         # optional, plugin-defined
---
Free-form write-up here.
```

Invalid or misfiled result files are shown in the dashboard as invalid, never silently dropped.

## Plugins

A plugin (`src/core/types.ts`) is a manifest, a JSON Schema for its settings, optional starter config, and one function: `collect(ctx)`, which writes evidence files into `ctx.evidenceDir`. The core owns scheduling (not yet), the run folder, sealing, config storage and validation, the dashboard and auth. To add a plugin, create `src/plugins/<name>/index.ts` and add it to the registry in `src/server/index.ts`. Check ids must be unique across plugins because evidence folders are keyed by check.

The collect contract is deliberately plain (settings and scope in, files out) so a plugin can later run in its own container.

### Cookies plugin

One check, "Tracking technology vs consent choice", with the three journeys inside it, because the important findings ("reject was clicked but a tracker still fired") only appear when journeys are compared. Split a check when its evidence, schedule or owner differs.

- `pre-interaction` runs the EDPS Website Evidence Collector as a separate, pinned process (`execFile`, never a shell). Its scratch Chrome profile (`browser-profile/`, tens of MB of volatile files) is deleted after each journey because it is not evidence and would make hashes unstable.
- `reject` and `accept` need a per-site banner recipe (selectors for the buttons) and are **not implemented**. Runs record them as `not-implemented` rather than pretending.

## Dashboard

The front page is a triage view for the DPO team. It shows a strip of counts (need attention, failed runs, awaiting review, overdue, total scopes), then one grid of scope tiles per check, worst first. A tile opens the latest run; its History link opens the scope's run history.

A scope's state comes only from the newest run and the newest valid result file in that run:

| State | When |
| --- | --- |
| Run failed | latest run did not complete |
| Issues proposed (severity) | newest result says `issues-proposed`; severity is the highest item |
| Inconclusive | newest result says `inconclusive` |
| Awaiting review | run completed but no valid result file exists yet. Never shown as clean. |
| No issues | newest result says `no-issues` |
| Never run / Running | no run yet / a run is in progress |

A scope is also marked overdue when its latest run is older than the check's `staleAfterDays` (default 7, set per check in the plugin config).

### How a plugin describes its layout

Plugins declare a `dashboard` block in their manifest. It is data, not markup, and is validated at startup, so a bad declaration stops the server rather than breaking a page. Core draws a fixed set of widgets:

- `tile`: up to four metrics shown on the scope tile.
- `history`: up to four metrics shown per run on the scope history page.
- `run`: ordered sections on the run page. `stats` shows metrics; `table` shows rows from an evidence file.

A metric reads a dot path from the `plugin` block of the newest result file (for example `journeys.pre-interaction.classified.marketing`), with optional `suffix` and `warnAbove`. A table names an evidence file (a leading `*/` repeats it for each journey folder), an optional `rows` path, `fromObject` for object-shaped files, columns as dot paths, `sortBy` and `limit`. Only files listed in the run's manifest are read.

A plugin that declares nothing still works: the generic view shows outcome, findings and evidence files.

## Configuration

Edited in the dashboard (JSON editor for now), validated against the plugin's schema, stored under `data/config/`. Each save creates a new revision and keeps the old one. Runs record the revision they used, so old evidence stays interpretable after settings change. Secrets (proxy credentials, API keys) do not go in config files; use environment variables or a future encrypted store.

## Auth

Basic and deliberately small, behind an `AuthProvider` interface (`src/auth/provider.ts`) so SSO (Entra ID) or a proxy-header provider can replace it without touching routes.

- First admin is created from `PRIVVY_ADMIN_PASSWORD` (12+ characters) only when no users exist. No default password. Remove it afterwards.
- argon2id hashes, server-side session (HttpOnly, SameSite=Strict, Secure when `PRIVVY_COOKIE_SECURE=true`), session id regenerated on login.
- CSRF token on every state-changing form, login rate limit (5 per minute per address), strict security headers, `Cache-Control: no-store`.
- Only `admin` exists. A read-only `viewer` role is a small addition later.
- Evidence downloads serve only files listed in the manifest.
- Bind to localhost or a private network. Do not expose the port to the internet without a review.

## Deployment

Docker, one container for now. Compose publishes on `127.0.0.1` only. Chromium comes from Debian so one image works on amd64 and arm64. `shm_size: 1gb` is needed for Chromium. Run as a non-root user matching the owner of `./data`.

## Not built yet

- Scheduler (schedules are stored but nothing fires them).
- Reject and accept journeys.
- Settings forms rendered from the schema (JSON editor today).
- Index for faster listing (the tree is scanned on each page load).
- Splitting the worker (Chromium) from the web app into two containers.
- Per-market vantage points (VPN sidecar per market) so scans reflect UK, EU and other users.
- Viewer role and SSO.
- Further plugins: email review, ROPA and vendor cross-referencing, privacy notice change detection.
- Markdown rendering of results (shown as plain text today).

## Open questions

- Bot protection on the target sites: allowlist the scanner rather than evade it.
