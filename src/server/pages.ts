import type { VerifyReport } from "../core/evidence.js";
import type { ParsedResult } from "../core/results.js";
import type { Manifest } from "../core/types.js";
import type { MetricValue, ScopeState, TableData } from "../core/dashboard.js";
import { stateLabel } from "../core/dashboard.js";
import { esc, html, Raw } from "./views.js";

const tag = (outcome: string) =>
  outcome === "issues-proposed" ? "bad" : outcome === "no-issues" ? "ok" : "muted";

export function loginBody(o: { setupNeeded: boolean; csrf: string }): Raw {
  return html`<div class="narrow"><h1>Sign in</h1>
${o.setupNeeded ? html`<div class="card bad">No users exist yet. Set <code>PRIVVY_ADMIN_PASSWORD</code> (12+ characters) and restart to create the first admin.</div>` : html``}
<form method="post" action="/login"><input type="hidden" name="_csrf" value="${o.csrf}">
<p><label>Username<br><input name="username" autocomplete="username" required autofocus></label></p>
<p><label>Password<br><input name="password" type="password" autocomplete="current-password" required></label></p>
<button class="primary">Sign in</button></form></div>`;
}

export interface TileView {
  checkId: string;
  scopeId: string;
  label: string;
  running: boolean;
  state: ScopeState;
  lastRun: { runId: string; finishedAt: string } | null;
  metrics: MetricValue[];
  summary: string | null;
}
export interface CheckView { id: string; name: string; description: string; enabled: boolean; staleAfterDays: number; tiles: TileView[] }
export interface PluginView { id: string; name: string; description: string; enabled: boolean; revision: number; checks: CheckView[] }

const stateClass = (s: ScopeState) => (s.kind === "issues" ? `k-issues-${s.severity ?? "info"}` : `k-${s.kind}`);
const statePill = (s: ScopeState) =>
  s.kind === "failed" || (s.kind === "issues" && (s.severity === "high"))
    ? "bad"
    : s.kind === "issues" && s.severity === "medium"
      ? "warn"
      : s.kind === "no-issues"
        ? "ok"
        : s.kind === "awaiting-review"
          ? "info"
          : "";

function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

export function overviewBody(o: { csrf: string; plugins: PluginView[] }): Raw {
  const tiles = o.plugins.flatMap((p) => p.checks.flatMap((c) => c.tiles));
  const count = (f: (t: TileView) => boolean) => tiles.filter(f).length;
  const attention = count((t) => t.state.kind === "issues" && (t.state.severity === "high" || t.state.severity === "medium"));
  const failed = count((t) => t.state.kind === "failed");
  const awaiting = count((t) => t.state.kind === "awaiting-review");
  const overdue = count((t) => t.state.overdue);
  const stat = (n: number, label: string, hot: boolean) => html`<div class="stat ${hot && n > 0 ? "hot" : ""}"><b>${String(n)}</b><span>${label}</span></div>`;
  return html`<h1>Overview</h1>
<div class="strip">${stat(attention, "need attention (high or medium)", true)}${stat(failed, "failed runs", true)}${stat(awaiting, "awaiting review", false)}${stat(overdue, "overdue", true)}${stat(tiles.length, "scopes in total", false)}</div>
${o.plugins.map(
  (p) => html`<h2>${p.name} <span class="muted">${p.enabled ? "" : "disabled"}</span> <a href="/plugins/${p.id}" class="muted" style="font-size:13px;font-weight:400">Configure</a></h2>
${p.checks.map(
  (c) => html`<div><strong>${c.name}</strong> <span class="muted">${c.enabled ? "" : "(disabled) "}· overdue after ${String(c.staleAfterDays)} days</span><br><span class="muted">${c.description}</span></div>
${c.tiles.length === 0
  ? html`<p class="muted">No scopes configured. Add them under Configure.</p>`
  : html`<div class="grid">${c.tiles.map(
      (t) => html`<div class="tile ${stateClass(t.state)}">
<div><a class="stretch" href="${t.lastRun ? `/runs/${t.checkId}/${t.scopeId}/${t.lastRun.runId}` : `/scopes/${t.checkId}/${t.scopeId}`}">${t.label}</a></div>
<div><span class="pill ${statePill(t.state)}">${stateLabel(t.state)}</span>${t.state.overdue ? html` <span class="pill bad">overdue</span>` : html``}</div>
${t.metrics.length ? html`<div class="metrics">${t.metrics.map((m) => html`<span class="l">${m.label}</span><span class="${m.warn ? "w" : ""}">${m.value}</span>`)}</div>` : html``}
${t.summary ? html`<div class="sum">${t.summary}</div>` : html``}
<div class="foot"><span class="muted">${t.running ? "running…" : t.lastRun ? ago(t.lastRun.finishedAt) : "never run"}</span><span><a href="/scopes/${t.checkId}/${t.scopeId}">History</a> <form method="post" action="/checks/${t.checkId}/run" class="inline"><input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="scope" value="${t.scopeId}"><button ${t.running ? "disabled" : ""}>Run</button></form></span></div></div>`,
    )}</div>`}`,
)}`,
)}
${o.plugins.length === 0 ? html`<p class="muted">No plugins registered.</p>` : html``}`;
}

export interface HistoryRow {
  runId: string;
  status: string;
  startedAt: string;
  durationSec: number | null;
  configRevision: number | null;
  files: number;
  /** Newest valid result for the run, if any. */
  result: { outcome: string; author: string; items: number; top: string | null; summary: string } | null;
  resultFiles: number;
  metrics: MetricValue[];
}

export function scopeBody(o: {
  csrf: string;
  checkId: string;
  scopeId: string;
  label: string;
  url: string | null;
  running: boolean;
  rows: HistoryRow[];
}): Raw {
  return html`<p><a href="/">← Overview</a></p><h1>${o.label}</h1>
<p class="muted"><code>${o.checkId}</code> · <code>${o.scopeId}</code>${o.url ? html` · ${o.url}` : html``}</p>
<form method="post" action="/checks/${o.checkId}/run" class="inline"><input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="scope" value="${o.scopeId}"><button ${o.running ? "disabled" : ""}>Run now</button></form>
<h2>History <span class="muted">${String(o.rows.length)} runs, newest first</span></h2>
${o.rows.length === 0 ? html`<p class="muted">No runs yet for this scope.</p>` : html`<table><thead><tr><th>Run (UTC)</th><th>Status</th><th>Latest result</th><th>Plugin metrics</th></tr></thead><tbody>
${o.rows.map(
  (r) => html`<tr><td><a href="/runs/${o.checkId}/${o.scopeId}/${r.runId}">${r.startedAt.slice(0, 16).replace("T", " ")}</a><br><code class="muted">${r.runId}</code></td>
<td><span class="${r.status === "complete" ? "ok" : r.status === "unfinished" ? "muted" : "bad"}">${r.status}</span>${r.durationSec === null ? html`` : html`<br><span class="muted">${String(r.durationSec)}s · config rev ${String(r.configRevision ?? "?")}</span>`}</td>
<td>${r.result ? html`<span class="${tag(r.result.outcome)}">${r.result.outcome}</span> <span class="muted">(${String(r.result.items)} items${r.result.top ? `, top ${r.result.top}` : ""}, ${r.result.author}${r.resultFiles > 1 ? `, ${r.resultFiles} result files` : ""})</span><br>${r.result.summary}` : html`<span class="muted">${r.resultFiles ? "result file invalid" : "no result yet"}</span>`}</td>
<td>${r.metrics.length ? html`<div class="metrics">${r.metrics.map((m) => html`<span class="l">${m.label}</span><span class="${m.warn ? "w" : ""}">${m.value}</span>`)}</div>` : html`<span class="muted">${String(r.files)} files</span>`}</td></tr>`,
)}</tbody></table>`}`;
}

export function pluginBody(o: {
  csrf: string;
  id: string;
  name: string;
  revision: number;
  configText: string;
  schemaText: string;
  problems: string[];
  isStarter: boolean;
}): Raw {
  return html`<h1>${o.name}</h1>
<p class="muted">${o.isStarter ? "Nothing saved yet. This is a starter example; edit it and save." : `Saved revision ${o.revision}. Every revision is kept.`}</p>
${o.problems.length ? html`<div class="card bad"><strong>Not saved:</strong><ul>${o.problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : html``}
<form method="post" action="/plugins/${o.id}"><input type="hidden" name="_csrf" value="${o.csrf}">
<textarea name="config" spellcheck="false">${o.configText}</textarea>
<p><button class="primary">Save configuration</button></p></form>
<details><summary>Settings schema</summary><pre><code>${o.schemaText}</code></pre></details>`;
}

export function runBody(o: {
  csrf: string;
  manifest: Manifest;
  results: ParsedResult[];
  verify: VerifyReport | null;
  stats: { title: string | undefined; metrics: MetricValue[] }[];
  tables: TableData[];
}): Raw {
  const m = o.manifest;
  const base = `/runs/${m.checkId}/${m.scopeId}/${m.runId}`;
  return html`<p><a href="/">← Overview</a></p><h1>${m.scope.label}</h1>
<p class="muted"><code>${m.checkId}</code> · run <code>${m.runId}</code></p>
<div class="card"><table><tbody>
<tr><th>Status</th><td class="${m.status === "complete" ? "ok" : "bad"}">${m.status}${m.error ? html` · ${m.error}` : html``}</td></tr>
<tr><th>Started</th><td>${m.startedAt}</td></tr><tr><th>Finished</th><td>${m.finishedAt}</td></tr>
<tr><th>Plugin</th><td>${m.pluginId} ${m.pluginVersion} · check version ${m.checkVersion}</td></tr>
<tr><th>Config</th><td>revision ${m.config.revision} · <code>${m.config.sha256.slice(0, 16)}…</code></td></tr>
${m.notes ? html`<tr><th>Notes</th><td><pre>${JSON.stringify(m.notes, null, 2)}</pre></td></tr>` : html``}
</tbody></table></div>

<h2>Results</h2>
${o.results.length === 0 ? html`<p class="muted">No results yet. Analysis files go in <code>results/</code> inside this run's folder.</p>` : o.results.map((r) =>
  r.ok
    ? html`<div class="card"><strong class="${tag(r.frontMatter.outcome)}">${r.frontMatter.outcome}</strong> <span class="muted">${r.file} · ${r.frontMatter.author} · ${r.frontMatter.createdAt}</span>
<p>${r.frontMatter.summary}</p>
${r.frontMatter.items.length ? html`<table><thead><tr><th>Severity</th><th>Item</th><th>Evidence</th></tr></thead><tbody>${r.frontMatter.items.map((i) => html`<tr><td>${i.severity}</td><td><strong>${i.title}</strong><br><span class="muted">${i.detail ?? ""}</span></td><td>${i.evidence.map((e) => html`<code>${e}</code><br>`)}</td></tr>`)}</tbody></table>` : html``}
${r.body.trim() ? html`<details><summary>Full write-up</summary><pre>${r.body}</pre></details>` : html``}</div>`
    : html`<div class="card"><strong class="bad">Invalid result file</strong> <code>${r.file}</code><br><span class="muted">${r.error}</span></div>`,
)}

${o.stats.map((w) => html`<h2>${w.title ?? "Summary"}</h2><div class="strip">${w.metrics.map((m) => html`<div class="stat ${m.warn ? "hot" : ""}"><b>${m.value}</b><span>${m.label}</span></div>`)}</div>`)}
${o.tables.map((t) => html`<h2>${t.title}${t.group ? html` <span class="muted">${t.group}</span>` : html``} <span class="muted">${String(t.total)} rows${t.rows.length < t.total ? `, showing ${t.rows.length}` : ""}</span></h2>
${t.note ? html`<p class="muted">${t.note}</p>` : html`<div class="scroll"><table><thead><tr>${t.columns.map((c) => html`<th>${c}</th>`)}</tr></thead><tbody>${t.rows.map((r) => html`<tr>${r.map((v) => html`<td class="wrap">${v}</td>`)}</tr>`)}</tbody></table></div>`}`)}

<h2>Evidence</h2>
<p>${o.verify ? (o.verify.ok ? html`<span class="ok">Integrity verified: every file matches its recorded hash.</span>` : html`<span class="bad">Integrity problems:</span><ul>${o.verify.problems.map((p) => html`<li>${p}</li>`)}</ul>`) : html`<a href="${base}?verify=1">Verify integrity</a>`}</p>
<table><thead><tr><th>File</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>
${m.files.map((f) => html`<tr><td><a href="${base}/file?path=${encodeURIComponent(f.path)}">${f.path}</a></td><td>${f.bytes}</td><td><code>${f.sha256.slice(0, 16)}…</code></td></tr>`)}</tbody></table>
<h2>Run log</h2><pre class="card">${m.log.join("\n")}</pre>`;
}

export { esc };
