// No runtime imports: `node --test` runs this straight from source.
import type { EvidenceModel, EvidenceTotals, TestRow } from './model.js';

export interface FullFlow {
  title: string;
  description?: string;
  /** Site-relative href of the stitched video. */
  href: string;
  /** How many clips it joins. */
  clips: number;
}

export interface RenderOptions {
  title: string;
  /** One sentence under the title: what ran, where. `{date}` is replaced by the run date. */
  subtitle?: string;
  /** Prefix a transaction hash is appended to, e.g. `https://sepolia.basescan.org/tx/`. */
  explorerTxUrl?: string;
  fullFlow?: FullFlow;
  totals: EvidenceTotals;
}

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const short = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

function transactionTable(row: TestRow, explorer?: string): string {
  if (row.transactions.length === 0) return '';
  const withOps = row.transactions.some((tx) => tx.userOpHash);
  const cell = (hash: string): string => explorer
    ? `<a href="${esc(explorer)}${esc(hash)}" target="_blank" rel="noopener">${esc(short(hash))}</a>`
    : `<code>${esc(short(hash))}</code>`;
  return `<table><thead><tr><th>Transaction</th>${withOps ? '<th>User operation</th>' : ''}</tr></thead><tbody>${
    row.transactions.map((tx) => `<tr><td>${cell(tx.hash)}</td>${withOps ? `<td><code>${tx.userOpHash ? esc(short(tx.userOpHash)) : ''}</code></td>` : ''}</tr>`).join('')
  }</tbody></table>`;
}

function article(row: TestRow, explorer?: string): string {
  const describes = row.titlePath.slice(0, -1).join(' › ');
  return `
  <article class="${esc(row.status)}">
    <h3><span class="dot"></span>${esc(row.title)} <small>${(row.duration / 1000).toFixed(1)}s · ${esc(row.status)}${describes ? ` · ${esc(describes)}` : ''}</small></h3>
    ${row.error ? `<pre class="err">${esc(row.error.slice(0, 1200))}</pre>` : ''}
    ${transactionTable(row, explorer)}
    ${row.video ? `<video controls preload="metadata" src="${esc(row.video)}"></video>` : ''}
    ${row.screenshots.length ? `<div class="shots">${row.screenshots.map((shot) => `<figure><img loading="lazy" src="${esc(shot.href)}" alt="${esc(shot.name)}"><figcaption>${esc(shot.name)}</figcaption></figure>`).join('')}</div>` : ''}
  </article>`;
}

const STYLE = `
:root{--bg:#f6f7f9;--fg:#15181d;--muted:#5d6572;--card:#fff;--line:#e3e6ea;--ok:#1a7f4b;--bad:#c0392b;--skip:#8a6d1f;--accent:#2d5be3;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0f1115;--fg:#e8eaee;--muted:#9aa3af;--card:#171a20;--line:#2a2f38;--ok:#3ccf7a;--bad:#ff6b5b;--skip:#e0b84a;--accent:#7aa2ff;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
img{max-width:100%}article,section{min-width:0}
main{max-width:1040px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1{font-size:26px;margin:0 0 4px;text-wrap:balance}.sub{color:var(--muted);margin:0 0 20px;max-width:70ch}
.totals{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 24px}.totals div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px}.totals b{font-size:22px;display:block}
section{margin:0 0 28px}h2{font-size:18px;margin:0 0 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.bad{color:var(--bad);border-color:var(--bad)}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 12px}
h3{font-size:15px;margin:0 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}h3 small{color:var(--muted);font-weight:400}
.dot{width:10px;height:10px;border-radius:50%;background:var(--skip);flex:none}.passed .dot{background:var(--ok)}.failed .dot,.timedOut .dot{background:var(--bad)}
table{border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:500}
a{color:var(--accent)}code{font-size:12px}video{width:100%;max-width:800px;border-radius:8px;border:1px solid var(--line);display:block;margin:8px 0;background:#000}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:8px}figure{margin:0}figure img{width:100%;border-radius:6px;border:1px solid var(--line)}figcaption{font-size:12px;color:var(--muted)}
pre.err{white-space:pre-wrap;font-size:12px;color:var(--bad);border:1px solid var(--line);border-radius:8px;padding:8px}
`;

/** The whole site as one HTML document: totals, an optional full-flow video, then every spec. */
export function renderSite(model: EvidenceModel, options: RenderOptions): string {
  const { title, explorerTxUrl, fullFlow, totals } = options;
  const subtitle = (options.subtitle ?? `Playwright wallet e2e run of {date}: every test with its video, screenshots and transactions.`)
    .replace('{date}', model.runDate);
  const sections = model.specs.map((spec) => `
<section>
  <h2>${esc(spec.file)} <span class="pill ${spec.tests.some((t) => t.status === 'failed' || t.status === 'timedOut') ? 'bad' : 'ok'}">${spec.tests.filter((t) => t.status === 'passed').length}/${spec.tests.length} passed</span></h2>${spec.tests.map((row) => article(row, explorerTxUrl)).join('')}
</section>`).join('');
  const flow = fullFlow ? `
<section>
  <h2>${esc(fullFlow.title)} <span class="pill ok">${fullFlow.clips} clips in run order</span></h2>
  <article class="passed">
    ${fullFlow.description ? `<p>${esc(fullFlow.description)}</p>` : ''}
    <video controls preload="metadata" src="${esc(fullFlow.href)}"></video>
  </article>
</section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta name="description" content="${esc(subtitle)}">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">${esc(subtitle)}</p>
<div class="totals"><div><b>${totals.passed}</b>passed</div><div><b>${totals.failed}</b>failed</div><div><b>${totals.skipped}</b>skipped</div><div><b>${totals.specs}</b>specs</div></div>
${flow}
${sections}
</main>
</body>
</html>
`;
}
