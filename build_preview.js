#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const katex = require('./vendor/katex/katex.min.js');

const ROOT = __dirname;
const mdPath = process.argv[2] || path.join(ROOT, '..', 'UIAD_完整稿_含图表.md');
const outPath = process.argv[3] || path.join(ROOT, 'index.html');

const md = fs.readFileSync(mdPath, 'utf8');

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderMath(tex, display) {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: !!display,
      output: 'htmlAndMathml',
    });
  } catch (e) {
    return esc(tex);
  }
}

const mathSlots = [];
function parkMath(src) {
  let s = src;
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    const i = mathSlots.length;
    mathSlots.push(renderMath(tex.trim(), true));
    return `\u0000MATH${i}\u0000`;
  });
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
    const i = mathSlots.length;
    mathSlots.push(renderMath(tex.trim(), true));
    return `\u0000MATH${i}\u0000`;
  });
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => {
    const i = mathSlots.length;
    mathSlots.push(renderMath(tex.trim(), false));
    return `\u0000MATH${i}\u0000`;
  });
  s = s.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_, pre, tex) => {
    const i = mathSlots.length;
    mathSlots.push(renderMath(tex.trim(), false));
    return `${pre}\u0000MATH${i}\u0000`;
  });
  return s;
}

function unpark(s) {
  return s.replace(/\u0000MATH(\d+)\u0000/g, (_, i) => {
    const html = mathSlots[Number(i)];
    if (html.includes('katex-display')) {
      return `<div class="math-block">${html}</div>`;
    }
    return html;
  });
}

function inlineFormat(s) {
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    `<img src="${esc(src)}" alt="${esc(alt)}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) =>
    `<a href="${esc(u)}">${esc(t)}</a>`);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function renderTable(rows) {
  if (rows.length < 2) return null;
  const split = (line) => line.replace(/^\||\|$/g,'').split('|').map(c => c.trim());
  const heads = split(rows[0]);
  const body = rows.slice(2).map(split);
  let html = '<table><thead><tr>' + heads.map(h => `<th>${inlineFormat(h)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of body) {
    html += '<tr>' + r.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function paraClass(text) {
  const t = text.trim();
  // English subtitle (ASCII-heavy line right under title)
  if (/^[A-Za-z].{10,}/.test(t) && !t.includes('：') && t.length < 160 && !t.startsWith('**')) {
    return 'subtitle';
  }
  // author / affiliation lines
  if (/^(作者|单位|通讯|作者：|单位：|通讯：)/.test(t)) return 'meta';
  // keywords
  if (/^\*\*关键词/.test(t) || /^关键词[：:]/.test(t)) return 'keywords';
  // figure / table captions only (e.g. **图1** ...), not body sentences starting with 图2
  if (/^\*\*图\d+\*\*/.test(t) || /^\*\*表\d+\*\*/.test(t)) {
    return 'caption';
  }
  return '';
}

function mdToHtml(src) {
  const parked = parkMath(src);
  const lines = parked.split('\n');
  const out = [];
  let i = 0;
  let inUl = false;
  let para = [];

  function flushPara() {
    if (!para.length) return;
    const text = para.join('\n').trim();
    para = [];
    if (!text) return;
    const cls = paraClass(text);
    const body = inlineFormat(text).replace(/\n/g, '<br>');
    if (cls) out.push(`<p class="${cls}">${body}</p>`);
    else out.push(`<p>${body}</p>`);
  }
  function closeUl() {
    if (inUl) { out.push('</ul>'); inUl = false; }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-/.test(lines[i+1])) {
      flushPara(); closeUl();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      out.push(renderTable(rows));
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      flushPara(); closeUl();
      out.push('<hr>');
      i++; continue;
    }

    const hm = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hm) {
      flushPara(); closeUl();
      const level = hm[1].length;
      out.push(`<h${level}>${inlineFormat(hm[2])}</h${level}>`);
      i++; continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      i++; continue;
    }
    const ol = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      closeUl();
      const items = [];
      while (i < lines.length) {
        const m = /^(\d+)\.\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[2]);
        i++;
      }
      out.push('<ol>' + items.map(t => `<li>${inlineFormat(t)}</li>`).join('') + '</ol>');
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushPara(); closeUl();
      i++; continue;
    }

    closeUl();
    para.push(line);
    i++;
  }
  flushPara(); closeUl();
  return unpark(out.join('\n'));
}

const titleMatch = md.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1].trim() : 'UIAD';
const fullBody = mdToHtml(md);

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="vendor/katex/katex.min.css">
<style>
:root {
  --text: #1f2328;
  --muted: #57606a;
  --border: #e6e8eb;
  --bg: #ffffff;
}
* { box-sizing: border-box; }
body {
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
  max-width: 820px;
  margin: 0 auto;
  padding: 2.4rem 1.6rem 3.5rem;
  line-height: 1.85;
  color: var(--text);
  background: var(--bg);
  font-size: 16.5px;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, h4 {
  font-weight: 650;
  line-height: 1.35;
  text-indent: 0 !important;
}
h1 { font-size: 1.55rem; margin: 0 0 .6rem; }
h2 {
  margin-top: 2rem;
  margin-bottom: .85rem;
  font-size: 1.25rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: .35rem;
}
h3 { margin-top: 1.35rem; margin-bottom: .55rem; font-size: 1.08rem; }
p {
  margin: .75rem 0;
  text-indent: 2em;
}
p.subtitle {
  text-indent: 0;
  color: var(--muted);
  font-size: 1.02rem;
  margin: .15rem 0 1rem;
  line-height: 1.5;
}
p.meta {
  text-indent: 0;
  color: var(--muted);
  margin: .15rem 0;
  font-size: .95rem;
}
p.keywords {
  text-indent: 0;
  margin: 1rem 0 0;
}
p.caption {
  text-indent: 0;
  text-align: center;
  color: var(--muted);
  font-size: .95rem;
  margin: .35rem 0 1.1rem;
}
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: .9rem auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  object-fit: contain;
  background: #fff;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0 1.2rem;
  font-size: .95rem;
  text-indent: 0;
}
th, td {
  border: 1px solid #d0d7de;
  padding: .45rem .6rem;
  text-align: left;
  text-indent: 0;
  vertical-align: top;
}
th { background: #f6f8fa; font-weight: 600; }
ul, ol {
  margin: .55rem 0 .9rem 0;
  padding-left: 1.6rem;
  text-indent: 0;
}
li {
  margin: .28rem 0;
  text-indent: 0;
  padding-left: .15rem;
}
li > p { text-indent: 0; margin: .2rem 0; }
code {
  background: #f4f6f8;
  padding: .05rem .28rem;
  border-radius: 3px;
  font-size: .92em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.6rem 0;
}
.math-block {
  overflow-x: auto;
  margin: 1rem 0;
  padding: .55rem .4rem;
  background: transparent;
  border: none;
  text-align: center;
  text-indent: 0;
}
.math-block .katex-display {
  margin: .4rem 0;
}
.katex { font-size: 1.05em; }
strong { font-weight: 650; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
@media (max-width: 640px) {
  body { padding: 1.4rem 1rem 2.5rem; font-size: 16px; }
  p { text-indent: 2em; }
}
</style></head><body>
${fullBody}
</body></html>
`;

fs.writeFileSync(outPath, html);
console.log('Wrote', outPath, 'bytes', html.length, 'math slots', mathSlots.length);
const leak = (html.match(/\\\(|\\\[|\$\$/g) || []).length;
console.log('raw math delimiter leaks (approx):', leak);
