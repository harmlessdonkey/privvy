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
code{font-family:ui-monospace,Menlo,monospace;font-size:13px}.narrow{max-width:360px;margin:12vh auto}
`;

export interface Layout {
  title: string;
  user: { username: string } | null;
  csrf: string;
  flash?: string | undefined;
  body: Raw;
}

export function page(l: Layout): string {
  const nav = l.user
    ? html`<form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${l.csrf}"><span class="muted">${l.user.username}</span> <button>Sign out</button></form>`
    : html``;
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${l.title} · privvy</title><style>${new Raw(CSS)}</style></head><body>
<header><a href="/">privvy</a>${nav}</header><main>${l.flash ? html`<div class="flash">${l.flash}</div>` : html``}${l.body}</main></body></html>`.value;
}
