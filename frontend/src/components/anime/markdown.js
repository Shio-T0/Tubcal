// AniList's markdown dialect, rendered in the browser — the composer's instant
// preview. The output is an HTML string that goes through the same sanitiser as
// everything AniList sends (RichText.jsx), so it can only produce the tags a real
// post can. When typing pauses, the composer swaps in AniList's own rendering of
// the text, so what you finally see is exactly what everyone else will.
//
// Dialect covered: # headings, > quotes, - / 1. lists, --- rules, ``` code blocks,
// `code`, **bold** / __bold__, *italic* / _italic_, ~~strike~~, ~!spoiler!~,
// ~~~centre~~~, [text](url), img(url) / img220(url) / img50%(url), youtube(id|url),
// webm(url), bare links, @mentions, and a single newline as a line break (as
// AniList does).

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function youtubeHref(v) {
  if (/^https?:\/\//i.test(v)) return v;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;
}

function inline(s) {
  // Code spans first, parked behind placeholders so nothing else touches them.
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });

  s = s.replace(/img(\d{1,4}%?)?\((https?:\/\/[^\s)]+)\)/gi,
    (_, w, u) => `<img src="${u}"${w ? ` width="${w}"` : ''}>`);
  s = s.replace(/youtube\(([^)\s]+)\)/gi, (_, v) => `<a href="${youtubeHref(v)}">▶ YouTube video</a>`);
  s = s.replace(/webm\((https?:\/\/[^)\s]+)\)/gi, (_, u) => `<a href="${u}">▶ video</a>`);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/~~~([\s\S]+?)~~~/g, '<center>$1</center>');
  s = s.replace(/~!([\s\S]+?)!~/g, "<span class='markdown_spoiler'><span>$1</span></span>");
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]+?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]+?\S)~~/g, '<del>$1</del>');
  // Bare links — only where a URL starts a word, so attributes above are left alone.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  // @mentions become profile links, as AniList makes them.
  s = s.replace(/(^|[\s(])@([A-Za-z0-9_]{2,20})\b/g, '$1<a href="https://anilist.co/user/$2/">@$2</a>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const LIST_UL = /^\s*[-*+]\s+/;
const LIST_OL = /^\s*\d+[.)]\s+/;
const QUOTE = /^&gt;\s?/;

export function aniMarkdown(source) {
  const lines = esc((source || '').replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let i = 0;
  const special = (l) => /^```/.test(l) || /^#{1,5}\s/.test(l) || QUOTE.test(l) || LIST_UL.test(l)
    || LIST_OL.test(l) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || /^\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i += 1; // the closing fence
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }
    if (/^\s*$/.test(line)) { i += 1; continue; }
    const h = line.match(/^(#{1,5})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
    if (QUOTE.test(line)) {
      const q = [];
      while (i < lines.length && QUOTE.test(lines[i])) q.push(lines[i++].replace(QUOTE, ''));
      out.push(`<blockquote>${inline(q.join('<br>'))}</blockquote>`);
      continue;
    }
    if (LIST_UL.test(line) || LIST_OL.test(line)) {
      const ordered = LIST_OL.test(line);
      const re = ordered ? LIST_OL : LIST_UL;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(re, ''))}</li>`);
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && !special(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(line); i += 1; }
    out.push(`<p>${inline(para.join('<br>'))}</p>`);
  }
  return out.join('');
}
