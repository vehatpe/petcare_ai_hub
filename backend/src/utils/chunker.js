'use strict';

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

/** Splits Markdown into ~maxChars chunks on headings, then paragraphs. Leading blockquote notes are dropped. */
function splitMarkdown(body, maxChars = 800) {
  const lines = body.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('>'))) i++;
  const sections = [];
  let heading = '';
  let buf = [];
  const flush = () => { const t = buf.join('\n').trim(); if (t) sections.push({ heading, text: t }); buf = []; };
  for (; i < lines.length; i++) {
    const h = /^(#{1,3})\s+(.*)$/.exec(lines[i]);
    if (h) { flush(); heading = h[2].trim(); } else buf.push(lines[i]);
  }
  flush();

  const chunks = [];
  for (const s of sections) {
    const prefix = s.heading ? s.heading + '\n' : '';
    let cur = '';
    for (const para of s.text.split(/\n{2,}/)) {
      const pieces = para.length > maxChars ? para.match(new RegExp(`[\\s\\S]{1,${maxChars}}(?:\\s|$)`, 'g')) : [para];
      for (const piece of pieces) {
        if (cur && (prefix + cur + '\n\n' + piece).length > maxChars) { chunks.push(prefix + cur.trim()); cur = ''; }
        cur += (cur ? '\n\n' : '') + piece.trim();
      }
    }
    if (cur.trim()) chunks.push(prefix + cur.trim());
  }
  return chunks;
}

module.exports = { parseFrontmatter, splitMarkdown };
