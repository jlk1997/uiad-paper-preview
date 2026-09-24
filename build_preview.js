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

// Protect math first
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
  // inline $...$ but not $$
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
    // display math detection: katex-display class
    if (html.includes('katex-display')) {
      return `<div class="math-block">${html}</div>`;
    }
    return html;
  });
}

function inlineFormat(s) {
  // images already handled at block level
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
    `<img src="${esc(src)}" alt="${esc(alt)}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) =>
    `<a href="${esc(u)}">${esc(t)}</a>`);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // escape remaining raw < that aren't tags we introduced — already mostly safe since we build from md
  return s;
}

function renderTable(rows) {
  if (rows.length < 2) return null;
  const split = (line) => line.replace(/^\||\|$/g,'').split('|').map(c => c.trim());
  const heads = split(rows[0]);
  // skip separator row[1]
  const body = rows.slice(2).map(split);
  let html = '<table><thead><tr>' + heads.map(h => `<th>${inlineFormat(h)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of body) {
    html += '<tr>' + r.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>';
  }
  html += '</tbody></table>';
  return html;
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
    out.push(`<p>${inlineFormat(text).replace(/\n/g, '<br>')}</p>`);
  }
  function closeUl() {
    if (inUl) { out.push('</ul>'); inUl = false; }
  }

  while (i < lines.length) {
    const line = lines[i];

    // table block
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
      // title h1 from first # already; use as-is
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
      // treat numbered as paragraphs with bold number or as ol — use ordered list
      flushPara();
      // simple: open ol if needed — use a flag; for simplicity push as <p> with number for contributions
      closeUl();
      // collect consecutive ol
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

    // caption lines like **图1** ...
    closeUl();
    para.push(line);
    i++;
  }
  flushPara(); closeUl();
  return unpark(out.join('\n'));
}

const titleMatch = md.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1].trim() : 'UIAD';
const bodyHtml = mdToHtml(md.replace(/^#\s+.+$/m, '').trim()); // drop duplicate h1 from body? keep it
// Actually keep full including h1
const fullBody = mdToHtml(md);

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="vendor/katex/katex.min.css">
<style>
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;max-width:860px;margin:2rem auto;padding:0 1.2rem;line-height:1.75;color:#222;background:#fff;}
h1{font-size:1.55rem;} h2{margin-top:1.8rem;border-bottom:1px solid #ddd;padding-bottom:.3rem;}
h3{margin-top:1.2rem;} img{max-width:100%;height:auto;display:block;margin:.8rem auto;border:1px solid #eee;}
table{border-collapse:collapse;width:100%;margin:1rem 0;} th,td{border:1px solid #ccc;padding:.4rem .6rem;}
th{background:#f6f6f6;} code{background:#f4f4f4;padding:0 .25rem;} .caption{color:#555;text-align:center;margin-top:-.3rem;margin-bottom:1rem;}
hr{border:none;border-top:1px solid #ddd;margin:1.4rem 0;}
.math-block{overflow-x:auto;margin:1rem 0;padding:.7rem;background:#fafafa;border-radius:6px;text-align:center;}
.subtitle{color:#555;font-size:1rem;margin-top:-.6rem;margin-bottom:1rem;}
</style></head><body>
${fullBody}
</body></html>
`;

fs.writeFileSync(outPath, html);
console.log('Wrote', outPath, 'bytes', html.length, 'math slots', mathSlots.length);
// sanity: raw delimiters should not leak (except inside annotation)
const leak = (html.match(/\\\(|\\\[|\$\$/g) || []).length;
console.log('raw math delimiter leaks (approx):', leak);
