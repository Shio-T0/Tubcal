// Take your Saved things with you: as a bookmarks file any browser imports, as
// Markdown (with your notes and done marks), or whole as JSON. Built here in the
// page from what's already loaded, so nothing is sent anywhere; the file is handed
// straight to the browser's own download.
//
//   exportSaved(format, items, { origin, now }) -> { name, mime, text }
//   download(file)                              -> saves it

import { ALL_CHANNELS } from './rooms.js';
import { KINDS, KIND_ORDER, channelOfItem, kindOf } from './saveable.js';

export const EXPORT_FORMATS = [
  { id: 'html', label: 'Bookmarks for any browser', ext: 'html', mime: 'text/html' },
  { id: 'md', label: 'Markdown, with your notes', ext: 'md', mime: 'text/markdown' },
  { id: 'json', label: 'Everything, as JSON', ext: 'json', mime: 'application/json' },
];

const CHANNEL_ORDER = [...ALL_CHANNELS.map((c) => c.id), null];
const channelName = (id) => ALL_CHANNELS.find((c) => c.id === id)?.label || 'Elsewhere';

/** An absolute address for an entry: its own URL, or a Tubcal page on this machine. */
export function linkOf(item, origin) {
  const u = String(item?.url || '');
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/') && origin) return origin + u;
  return '';
}

/** Channel → kind → items, in the Saved page's own order, newest kept first. */
export function grouped(items) {
  const out = [];
  for (const ch of CHANNEL_ORDER) {
    const inCh = items.filter((it) => (channelOfItem(it) || null) === ch);
    if (!inCh.length) continue;
    const kinds = KIND_ORDER
      .map((k) => ({ kind: k, label: KINDS[k].label, items: inCh.filter((it) => kindOf(it) === k) }))
      .filter((g) => g.items.length)
      .map((g) => ({ ...g, items: [...g.items].sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0)) }));
    out.push({ channel: ch, label: channelName(ch), kinds });
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (t) => (t ? new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** The Netscape bookmark format every browser imports: one folder per channel,
 *  one inside it per kind; a note becomes the bookmark's description. */
function toBookmarks(items, origin, now) {
  const stamp = Math.floor(now / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- Exported from Tubcal. Import it in any browser: Bookmarks → Import. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `  <DT><H3 ADD_DATE="${stamp}">Tubcal · Saved</H3>`,
    '  <DL><p>',
  ];
  for (const ch of grouped(items)) {
    lines.push(`    <DT><H3 ADD_DATE="${stamp}">${esc(ch.label)}</H3>`, '    <DL><p>');
    for (const g of ch.kinds) {
      lines.push(`      <DT><H3 ADD_DATE="${stamp}">${esc(g.label)}</H3>`, '      <DL><p>');
      for (const it of g.items) {
        const href = linkOf(it, origin);
        if (!href) continue; // a bookmark without an address can't be imported
        lines.push(`        <DT><A HREF="${esc(href)}" ADD_DATE="${it.saved_at || stamp}">${esc(it.title || href)}</A>`);
        if (it.note) lines.push(`        <DD>${esc(String(it.note).trim().replace(/\s*\n\s*/g, ' · '))}`);
      }
      lines.push('      </DL><p>');
    }
    lines.push('    </DL><p>');
  }
  lines.push('  </DL><p>', '</DL><p>', '');
  return lines.join('\n');
}

const mdText = (s) => String(s ?? '').replace(/([\\[\]*_`<>])/g, '\\$1').replace(/\s+/g, ' ').trim();

/** A readable list: channel and kind headings, a tick for what's done, the source
 *  and the day it was kept, and your note quoted underneath. */
function toMarkdown(items, origin, now) {
  const out = [
    '# Saved, from Tubcal',
    '',
    `${items.length} ${items.length === 1 ? 'thing' : 'things'} · exported ${day(now / 1000)}`,
    '',
  ];
  for (const ch of grouped(items)) {
    out.push(`## ${ch.label}`, '');
    for (const g of ch.kinds) {
      out.push(`### ${g.label}`, '');
      for (const it of g.items) {
        const href = linkOf(it, origin);
        const title = mdText(it.title || href || 'Untitled');
        const meta = [it.source ? mdText(it.source) : null, it.saved_at ? `kept ${day(it.saved_at)}` : null].filter(Boolean).join(' · ');
        out.push(`- [${it.done_at ? 'x' : ' '}] ${href ? `[${title}](<${href}>)` : title}${meta ? ` — ${meta}` : ''}`);
        if (it.note) out.push(...String(it.note).split('\n').map((l) => `  > ${l}`));
      }
      out.push('');
    }
  }
  return out.join('\n');
}

export function exportSaved(format, items, { origin = '', now = Date.now() } = {}) {
  const f = EXPORT_FORMATS.find((x) => x.id === format) || EXPORT_FORMATS[0];
  const date = new Date(now).toLocaleDateString('en-CA');
  let text;
  if (f.id === 'html') text = toBookmarks(items, origin, now);
  else if (f.id === 'md') text = toMarkdown(items, origin, now);
  else text = `${JSON.stringify({ app: 'Tubcal', exported_at: Math.floor(now / 1000), count: items.length, items }, null, 2)}\n`;
  return { name: `tubcal-saved-${date}.${f.ext}`, mime: `${f.mime};charset=utf-8`, text };
}

/** Hand a file to the browser's download, no server involved. */
export function download({ name, mime, text }) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
