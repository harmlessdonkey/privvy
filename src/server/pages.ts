import type { VerifyReport } from "../core/evidence.js";
import type { ParsedResult } from "../core/results.js";
import type { Manifest } from "../core/types.js";
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

export interface ScopeView {
  checkId: string;
  scopeId: string;
  label: string;
  running: boolean;
  lastRun: { runId: string; status: string; finishedAt: string } | null;
  lastResult: { outcome: string; summary: string; author: string; items: number } | null;
}
export interface CheckView { id: string; name: string; description: string; enabled: boolean; scopes: ScopeView[] }
export interface PluginView { id: string; name: string; description: string; enabled: boolean; revision: number; checks: CheckView[] }

export function overviewBody(o: { csrf: string; plugins: PluginView[] }): Raw {
  return html`<h1>Overview</h1>
${o.plugins.map(
  (p) => html`<h2>${p.name} <span class="muted">${p.enabled ? "enabled" : "disabled"}</span> · <a href="/plugins/${p.id}">Configure</a></h2>
<p class="muted">${p.description}</p>
${p.checks.map(
  (c) => html`<div class="card"><strong>${c.name}</strong> <span class="muted">${c.enabled ? "" : "(disabled)"}</span><br><span class="muted">${c.description}</span>
${c.scopes.length === 0
  ? html`<p class="muted">No scopes configured. Add them under Configure.</p>`
  : html`<table><thead><tr><th>Scope</th><th>Last run</th><th>Latest result</th><th></th></tr></thead><tbody>
${c.scopes.map(
  (s) => html`<tr><td><a href="/scopes/${s.checkId}/${s.scopeId}">${s.label}</a><br><code class="muted">${s.scopeId}</code></td>
<td>${s.running ? html`<span class="muted">running…</span>` : s.lastRun ? html`<a href="/runs/${s.checkId}/${s.scopeId}/${s.lastRun.runId}">${s.lastRun.finishedAt.slice(0, 16).replace("T", " ")} UTC</a><br><span class="${s.lastRun.status === "complete" ? "ok" : "bad"}">${s.lastRun.status}</span>` : html`<span class="muted">never</span>`}</td>
<td>${s.lastResult ? html`<span class="${tag(s.lastResult.outcome)}">${s.lastResult.outcome}</span> <span class="muted">(${s.lastResult.items} items, ${s.lastResult.author})</span><br>${s.lastResult.summary}` : html`<span class="muted">none yet</span>`}</td>
<td><form method="post" action="/checks/${s.checkId}/run" class="inline"><input type="hidden" name="_csrf" value="${o.csrf}"><input type="hidden" name="scope" value="${s.scopeId}"><button ${s.running ? "disabled" : ""}>Run now</button></form></td></tr>`,
)}</tbody></table>`}</div>`,
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
${o.rows.length === 0 ? html`<p class="muted">No runs yet for this scope.</p>` : html`<table><thead><tr><th>Run (UTC)</th><th>Status</th><th>Latest result</th><th>Evidence</th></tr></thead><tbody>
${o.rows.map(
  (r) => html`<tr><td><a href="/runs/${o.checkId}/${o.scopeId}/${r.runId}">${r.startedAt.slice(0, 16).replace("T", " ")}</a><br><code class="muted">${r.runId}</code></td>
<td><span class="${r.status === "complete" ? "ok" : r.status === "unfinished" ? "muted" : "bad"}">${r.status}</span>${r.durationSec === null ? html`` : html`<br><span class="muted">${String(r.durationSec)}s · config rev ${String(r.configRevision ?? "?")}</span>`}</td>
<td>${r.result ? html`<span class="${tag(r.result.outcome)}">${r.result.outcome}</span> <span class="muted">(${String(r.result.items)} items${r.result.top ? `, top ${r.result.top}` : ""}, ${r.result.author}${r.resultFiles > 1 ? `, ${r.resultFiles} result files` : ""})</span><br>${r.result.summary}` : html`<span class="muted">${r.resultFiles ? "result file invalid" : "no result yet"}</span>`}</td>
<td>${String(r.files)} files</td></tr>`,
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

<h2>Evidence</h2>
<p>${o.verify ? (o.verify.ok ? html`<span class="ok">Integrity verified: every file matches its recorded hash.</span>` : html`<span class="bad">Integrity problems:</span><ul>${o.verify.problems.map((p) => html`<li>${p}</li>`)}</ul>`) : html`<a href="${base}?verify=1">Verify integrity</a>`}</p>
<table><thead><tr><th>File</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>
${m.files.map((f) => html`<tr><td><a href="${base}/file?path=${encodeURIComponent(f.path)}">${f.path}</a></td><td>${f.bytes}</td><td><code>${f.sha256.slice(0, 16)}…</code></td></tr>`)}</tbody></table>
<h2>Run log</h2><pre class="card">${m.log.join("\n")}</pre>`;
}

export { esc };
