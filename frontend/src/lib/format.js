export function compact(n) {
  if (n === null || n === undefined) return null;
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

/** A file's size for people: "820 KB", "48.2 MB", "1.3 GB". */
export function fileSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// Remote HTML (Reddit and GitHub bodies, READMEs, feed posts) is kept to an
// allow-list. This page is the same origin as the API, the editor's terminal
// included, so a script slipping through would be a shell.
const KEEP = new Set(['A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE', 'CODE', 'DD', 'DEL', 'DETAILS',
  'DFN', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG',
  'INPUT', 'INS', 'KBD', 'LI', 'MARK', 'OL', 'P', 'PRE', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SMALL', 'SPAN',
  'STRIKE', 'STRONG', 'SUB', 'SUMMARY', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'TT', 'U',
  'UL', 'VAR']);
// Gone with everything inside them; any other tag is unwrapped to its contents.
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED',
  'APPLET', 'SVG', 'MATH', 'FORM', 'TEXTAREA', 'SELECT', 'BUTTON', 'LINK', 'META', 'BASE', 'TITLE', 'XMP',
  'NOEMBED', 'NOFRAMES', 'PLAINTEXT', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'DIALOG', 'PORTAL']);
const ATTRS = {
  '*': ['title', 'lang', 'dir', 'class', 'id', 'align'],
  A: ['href', 'name'], IMG: ['src', 'alt', 'width', 'height'], OL: ['start', 'type', 'reversed'], LI: ['value'],
  TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan', 'scope'], DETAILS: ['open'],
  INPUT: ['type', 'checked', 'disabled'], Q: ['cite'], BLOCKQUOTE: ['cite'],
};
const WEB = new Set(['http:', 'https:', 'mailto:']);

/** A link's address when it goes somewhere harmless: the web, mail, or a place
 *  in this app (relative). Resolved the way the browser will, so tabs, entities
 *  and stray spaces can't hide a javascript: or data: scheme. */
function keptHref(value, { relative = true } = {}) {
  const v = (value || '').trim();
  try {
    const u = new URL(v, 'https://relative.invalid/');
    if (!WEB.has(u.protocol)) return null;
    if (u.hostname === 'relative.invalid') return relative ? v : null;
    return v;
  } catch {
    return null;
  }
}

function clean(node) {
  for (const ch of [...node.childNodes]) {
    if (ch.nodeType === 3) continue;
    if (ch.nodeType !== 1) { ch.remove(); continue; }
    const tag = ch.tagName.toUpperCase();
    if (DROP.has(tag)) { ch.remove(); continue; }
    clean(ch);
    if (!KEEP.has(tag) || (tag === 'INPUT' && ch.getAttribute('type') !== 'checkbox')) {
      ch.replaceWith(...ch.childNodes);
      continue;
    }
    const allowed = ATTRS[tag] || [];
    for (const { name, value } of [...ch.attributes]) {
      const n = name.toLowerCase();
      if (!allowed.includes(n) && !ATTRS['*'].includes(n)) { ch.removeAttribute(name); continue; }
      if (n === 'href' || n === 'cite') {
        const ok = keptHref(value);
        if (ok == null) ch.removeAttribute(name); else ch.setAttribute(name, ok);
      } else if (n === 'src') {
        const ok = keptHref(value, { relative: false });
        if (ok == null || ok.startsWith('mailto:')) ch.removeAttribute(name);
      } else if (n === 'id' || n === 'name') {
        // GitHub's own prefix: a page's ids (and window's named properties) stay the page's
        if (!value.startsWith('user-content-')) ch.setAttribute(name, `user-content-${value}`);
      } else if (n === 'class') {
        const kept = value.split(/\s+/).filter((c) => /^[\w-]+$/.test(c) && !c.startsWith('tc-'));
        if (kept.length) ch.setAttribute('class', kept.join(' ')); else ch.removeAttribute('class');
      }
    }
    if (tag === 'IMG') {
      if (!ch.getAttribute('src')) { ch.remove(); continue; }
      ch.setAttribute('loading', 'lazy');
      ch.setAttribute('referrerpolicy', 'no-referrer');
    } else if (tag === 'INPUT') {
      ch.setAttribute('disabled', '');
    } else if (tag === 'A' && ch.getAttribute('href')) {
      ch.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

/** Remote HTML made safe to show: an allow-list of tags and attributes, links and
 *  pictures only to the web (links may also be relative), nothing that runs. */
export function sanitizeHtml(html) {
  if (!html) return '';
  // DOMParser's document is inert: nothing in it loads or runs while it's cleaned.
  const { body } = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  clean(body);
  return body.innerHTML;
}

/** `url` when it's a web (or mail) address, else null: what may be handed to
 *  window.open or another app. A feed or a saved entry can carry anything. */
export function webUrl(url) {
  return typeof url === 'string' ? keptHref(url, { relative: false }) : null;
}

/** Open a web address in a new tab; anything that isn't one is ignored. */
export function openWeb(url, features = 'noopener') {
  const u = webUrl(url);
  if (u) window.open(u, '_blank', features);
  return !!u;
}

const HN_KIND = /^(Ask|Show|Tell|Launch) HN:\s*/i;

/** "Ask HN: Why…" → { kind: 'Ask HN', rest: 'Why…' } */
export function splitKind(title = '') {
  const m = HN_KIND.exec(title);
  return m ? { kind: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} HN`, rest: title.slice(m[0].length) } : { kind: null, rest: title };
}
