// --- Partial extract: structured-source detection & range selection ---
// Formats: subtitles (SRT / ASS / SSA) select by time; mokuro output
// (.mokuro JSON / mokuro_text) selects by page. Detection is deliberately
// loose — an unusual file not being recognized is fine.
//
// All functions here are pure (no DOM, no state), so the parsers can be
// exercised with a node one-liner against real files.

const PAGE_MARKER = /^\s*[━\-=]{3,}\s*Page\s*\d+\s*[━\-=]{3,}\s*$/;
const SRT_TIME = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/;
const ASS_TIME = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,2})$/;

// SRT: blocks of `[index]\nHH:MM:SS,mmm --> HH:MM:SS,mmm\n<text>`, separated
// by blank lines. Inline tags (</>, {\...}) and &nbsp; are stripped.
export function parseSRT(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    if (!lines.length) continue;
    let i = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    if (i >= lines.length) continue;
    const m = lines[i].match(SRT_TIME);
    if (!m) continue;
    const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
    const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8].padEnd(3, '0')) / 1000;
    const cueText = lines.slice(i + 1).join('\n')
      .replace(/<[^>]+>/g, '').replace(/\{\\[^}]+}/g, '').replace(/&nbsp;/g, ' ').trim();
    if (cueText) cues.push({ start, end, text: cueText });
  }
  return cues;
}

// ASS/SSA: `Dialogue: Layer,Start,End,Style,Name,M,L,M,V,Effect,Text`
// (standard column order; Text may contain commas). Times are H:MM:SS.cc.
export function parseASS(text) {
  const cues = [];
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    const s = line.trim();
    if (!/^Dialogue\s*:/.test(s)) continue;
    const parts = s.replace(/^Dialogue\s*:/, '').split(',');
    if (parts.length < 10) continue;
    const time = (p) => {
      const m = p.trim().match(ASS_TIME);
      if (!m) return null;
      return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 100;
    };
    const start = time(parts[1]), end = time(parts[2]);
    if (start == null || end == null) continue;
    const cueText = parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/gi, '\n').trim();
    if (cueText) cues.push({ start, end, text: cueText });
  }
  return cues;
}

// .mokuro JSON: {"pages":[{ "blocks":[{ "lines":[ ... ] }] }]}. One page per
// array entry; page text is the blocks' lines joined.
export function parseMokuroJSON(text) {
  const data = JSON.parse(text);
  return (data.pages || []).map((p, i) => ({
    n: i + 1,
    text: (p.blocks || []).map(b => (b.lines || []).join('\n')).join('\n')
  }));
}

// mokuro_text: pages separated by `━━━━━ Page N ━━━━━` marker lines.
export function parseMokuroText(text) {
  const pages = [];
  let cur = null;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (PAGE_MARKER.test(line)) { cur = { n: pages.length + 1, text: '' }; pages.push(cur); continue; }
    if (cur) cur.text += (cur.text ? '\n' : '') + line;
  }
  return pages;
}

// Identify the structured format of a text. Prefers the file extension on
// upload; falls back to loose content checks for pasted text. Returns null
// when nothing matches. Never throws.
export function detectSource(text, fileName) {
  if (!text || !text.trim()) return null;
  const t = String(text).replace(/^﻿/, '');
  const name = (fileName || '').toLowerCase();

  if (name.endsWith('.srt')) {
    const cues = parseSRT(t);
    if (cues.length) return { kind: 'subs', subtype: 'srt', cues };
  } else if (name.endsWith('.ass') || name.endsWith('.ssa')) {
    const cues = parseASS(t);
    if (cues.length) return { kind: 'subs', subtype: 'ass', cues };
  } else if (name.endsWith('.mokuro')) {
    try {
      const pages = parseMokuroJSON(t);
      if (pages.length) return { kind: 'mokuro', subtype: 'mokuro', pages };
    } catch { /* fall through to content checks */ }
  }

  if (t.trimStart()[0] === '{') {
    try {
      const pages = parseMokuroJSON(t);
      if (pages.length) return { kind: 'mokuro', subtype: 'mokuro', pages };
    } catch { /* not JSON */ }
  }

  const textPages = parseMokuroText(t);
  if (textPages.length >= 2) return { kind: 'mokuro', subtype: 'mokuro_text', pages: textPages };

  const cues = parseSRT(t);
  if (cues.length >= 2) return { kind: 'subs', subtype: 'srt', cues };

  const assCues = parseASS(t);
  if (assCues.length >= 2) return { kind: 'subs', subtype: 'ass', cues: assCues };

  return null;
}

// The units inside [lo, hi]: cues whose time range overlaps the window, or
// pages with n in [lo, hi]. Used by both the preview and selectedText so the
// two always agree on what will be extracted.
export function selectedUnits(source, lo, hi) {
  if (!source) return [];
  if (source.kind === 'subs') return source.cues.filter(c => c.end >= lo && c.start <= hi);
  return source.pages.filter(p => p.n >= lo && p.n <= hi);
}

export function selectedText(source, lo, hi) {
  return selectedUnits(source, lo, hi).map(u => u.text).join('\n');
}
