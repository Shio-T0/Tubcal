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

/** Light HTML sanitizer for remote comment/post bodies. */
export function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(iframe|object|embed|form|link|meta)[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

const HN_KIND = /^(Ask|Show|Tell|Launch) HN:\s*/i;

/** "Ask HN: Why…" → { kind: 'Ask HN', rest: 'Why…' } */
export function splitKind(title = '') {
  const m = HN_KIND.exec(title);
  return m ? { kind: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} HN`, rest: title.slice(m[0].length) } : { kind: null, rest: title };
}
