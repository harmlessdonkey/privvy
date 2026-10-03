const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

/** Marks a string as already-safe HTML. Everything else interpolated by `html` is escaped. */
export class Raw {
  constructor(readonly value: string) {}
}

function render(v: unknown): string {
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Raw(out);
}

const CSS = `
:root{--bg:#fff;--fg:#1b1f24;--muted:#5b6570;--line:#d9dee4;--accent:#0b5cad;--bad:#b42318;--ok:#157347;--card:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0f1317;--fg:#e6eaee;--muted:#9aa5b1;--line:#2a323b;--accent:#6fb1ff;--bad:#ff8a80;--ok:#6fcf97;--card:#171d23}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 24px;border-bottom:1px solid var(--line)}
header a{color:var(--fg);text-decoration:none;font-weight:600}main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 16px}h2{font-size:17px;margin:28px 0 8px}table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:13px}
a{color:var(--accent)}.muted{color:var(--muted)}.bad{color:var(--bad)}.ok{color:var(--ok)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:8px 0}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
input,textarea{font:inherit;width:100%;padding:8px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:13px;min-height:360px}pre{white-space:pre-wrap;word-break:break-word;margin:0}
form.inline{display:inline}.flash{background:var(--card);border-left:3px solid var(--accent);padding:8px 12px;margin-bottom:16px}
main.wide{max-width:1200px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 8px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}.stat b{display:block;font-size:24px;line-height:1.2}.stat span{color:var(--muted);font-size:13px}
.stat.hot b{color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin:8px 0 20px}
.tile{position:relative;background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.tile:hover{border-color:var(--accent)}.tile a.stretch{color:var(--fg);text-decoration:none;font-weight:600}.tile a.stretch::after{content:"";position:absolute;inset:0}
.tile .foot{display:flex;justify-content:space-between;align-items:center;margin-top:auto;font-size:13px}.tile .foot a,.tile .foot form{position:relative;z-index:1}
.tile .sum{font-size:13px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.k-failed,.k-issues-high{border-left-color:var(--bad)}.k-issues-medium{border-left-color:#d9822b}.k-issues-low,.k-issues-info,.k-inconclusive{border-left-color:#c9a227}
.k-awaiting-review{border-left-color:var(--accent)}.k-no-issues{border-left-color:var(--ok)}.k-never,.k-running{border-left-color:var(--line)}
.pill{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.pill.bad{border-color:var(--bad)}.pill.ok{border-color:var(--ok)}.pill.warn{border-color:#d9822b;color:#d9822b}.pill.info{border-color:var(--accent);color:var(--accent)}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;font-size:13px}.metrics .l{color:var(--muted)}.metrics .w{color:var(--bad);font-weight:600}
.scroll{overflow-x:auto}td.wrap{word-break:break-all;max-width:420px}
code{font-family:ui-monospace,Menlo,monospace;font-size:13px}.narrow{max-width:360px;margin:12vh auto}
`;

export interface Layout {
  title: string;
  user: { username: string } | null;
  csrf: string;
  flash?: string | undefined;
  body: Raw;
  wide?: boolean;
}

export function page(l: Layout): string {
  const nav = l.user
    ? html`<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${l.csrf}"><span class="muted">${l.user.username}</span> <button>Sign out</button></form>`
    : html``;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${l.title} · privvy</title><style>${new Raw(CSS)}</style></head><body>
<header><a href="/">privvy</a>${nav}</header><main class="${l.wide ? "wide" : ""}">${l.flash ? html`<div class="flash">${l.flash}</div>` : html``}${l.body}</main></body></html>`.value;
}
