// Words about a video, made live: a description or a comment where a timestamp
// seeks the playing video, a link to another YouTube video opens it in the
// player, a #hashtag searches the Screening Room, a channel mention opens that
// channel, and anything else is an ordinary link out.
//
// Descriptions arrive as plain text; comments as Invidious HTML (relative
// /watch, /channel and /hashtag links, literal newlines). Both end up as React
// elements — the HTML is walked with an allow-list, never injected — so nothing a
// stranger typed can run here.

import { Fragment } from 'react';
import { ExternalLink, Play } from 'lucide-react';

import r from './rich.module.css';

// url | timestamp | hashtag, in one pass (a timestamp inside a URL is never split
// out, because the URL alternative wins at that position).
const TOKENS = /(https?:\/\/[^\s<>"]*[^\s<>".,!?:;'")\]])|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)|((?:^|(?<=\s))#[\p{L}\p{N}_]+)/gu;

/** "1:02:03" / "2:03" → seconds, or null when it isn't a real clock time. */
export function parseStamp(text) {
  const parts = text.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) {
    const [h, m, sec] = parts;
    return m < 60 && sec < 60 ? h * 3600 + m * 60 + sec : null;
  }
  const [m, sec] = parts;
  return sec < 60 ? m * 60 + sec : null;
}

/** The video id and start offset a YouTube URL points at, if it points at one. */
export function youtubeTarget(href) {
  let u;
  try {
    u = new URL(href, 'https://www.youtube.com');
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' && u.pathname === '/watch') id = u.searchParams.get('v');
  else if (host === 'youtube.com' && /^\/(shorts|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start');
  let start = null;
  if (t) {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    if (m) start = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  }
  return { id, start };
}

// A YouTube /redirect?q=… link, unwrapped to where it actually goes.
function unwrapRedirect(href) {
  try {
    const u = new URL(href, 'https://www.youtube.com');
    if (/youtube\.com$/.test(u.hostname) && u.pathname === '/redirect' && u.searchParams.get('q')) {
      return u.searchParams.get('q');
    }
  } catch { /* not a URL */ }
  return href;
}

function shortUrl(href) {
  try {
    const u = new URL(href);
    const path = u.pathname === '/' ? '' : u.pathname;
    const text = `${u.hostname.replace(/^www\./, '')}${path}`;
    return text.length > 42 ? `${text.slice(0, 40)}…` : text;
  } catch {
    return href;
  }
}

// ── the pieces ───────────────────────────────────────────────────────────────

function Stamp({ t, label, ctx }) {
  return (
    <button type="button" className={r.stamp} onClick={(e) => { e.stopPropagation(); ctx.onSeek?.(t); }} title={`Jump to ${label}`}>
      {label}
    </button>
  );
}

function VideoLink({ target, label, ctx }) {
  if (target.id === ctx.videoId && target.start != null) {
    return <Stamp t={target.start} label={label} ctx={ctx} />;
  }
  return (
    <button type="button" className={r.video} onClick={(e) => { e.stopPropagation(); ctx.onVideo?.(target.id, target.start); }} title="Play in the Screening Room">
      <Play size={10} fill="currentColor" /> {label}
    </button>
  );
}

function OutLink({ href, label }) {
  return (
    <a className={r.out} href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
      {label}<ExternalLink size={10} className={r.outIcon} />
    </a>
  );
}

function Tag({ tag, ctx }) {
  return (
    <button type="button" className={r.tag} onClick={(e) => { e.stopPropagation(); ctx.onSearch?.(tag); }} title={`Search ${tag}`}>
      {tag}
    </button>
  );
}

/** Plain text → nodes with every url / timestamp / hashtag made live. */
export function linkify(text, ctx, keyBase = 't') {
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKENS)) {
    const [whole, url, stamp, tag] = m;
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}${i++}`;
    if (url) {
      const target = youtubeTarget(url);
      out.push(target ? <VideoLink key={key} target={target} label={shortUrl(url)} ctx={ctx} /> : <OutLink key={key} href={url} label={shortUrl(url)} />);
    } else if (stamp) {
      const t = parseStamp(stamp);
      const fits = t != null && (!ctx.duration || t <= ctx.duration + 1);
      out.push(fits ? <Stamp key={key} t={t} label={stamp} ctx={ctx} /> : whole);
    } else if (tag) {
      out.push(<Tag key={key} tag={tag.trim()} ctx={ctx} />);
    }
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'S', 'DEL', 'U', 'SPAN', 'BR', 'P', 'DIV', 'CODE']);

function walk(node, ctx, key) {
  if (node.nodeType === 3) return linkify(node.nodeValue, ctx, key);
  if (node.nodeType !== 1) return null;
  const tag = node.tagName;
  const kids = () => Array.from(node.childNodes).map((c, i) => <Fragment key={i}>{walk(c, ctx, `${key}.${i}`)}</Fragment>);
  if (tag === 'BR') return <br key={key} />;
  if (tag === 'A') {
    const href = unwrapRedirect(node.getAttribute('href') || '');
    const label = node.textContent;
    const yt = youtubeTarget(href);
    if (yt && (href.startsWith('/watch') || /youtu/.test(href))) {
      // A bare "2:03" link to this same video is a timestamp.
      if (yt.id === ctx.videoId && yt.start != null) return <Stamp key={key} t={yt.start} label={label} ctx={ctx} />;
      return <VideoLink key={key} target={yt} label={label.startsWith('http') ? shortUrl(label) : label} ctx={ctx} />;
    }
    const channel = /^\/channel\/(UC[\w-]{10,})/.exec(href);
    if (channel) {
      return (
        <button key={key} type="button" className={r.mention} onClick={(e) => { e.stopPropagation(); ctx.onChannel?.(channel[1]); }}>
          {label}
        </button>
      );
    }
    const hashtag = /^\/hashtag\/([^/?#]+)/.exec(href);
    if (hashtag) return <Tag key={key} tag={`#${decodeURIComponent(hashtag[1])}`} ctx={ctx} />;
    if (/^https?:\/\//.test(href)) return <OutLink key={key} href={href} label={label.startsWith('http') ? shortUrl(label) : label} />;
    return <Fragment key={key}>{label}</Fragment>;
  }
  if (!KEEP.has(tag)) return <Fragment key={key}>{kids()}</Fragment>;
  const El = { STRONG: 'b', EM: 'i', DEL: 's', P: 'span', DIV: 'span' }[tag] || tag.toLowerCase();
  return <El key={key}>{kids()}</El>;
}

/** Invidious comment HTML → safe, live React nodes. */
export function RichHtml({ html, ctx, className }) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return (
    <div className={`${r.rich} ${className || ''}`}>
      {Array.from(doc.body.childNodes).map((n, i) => <Fragment key={i}>{walk(n, ctx, `n${i}`)}</Fragment>)}
    </div>
  );
}

/** Plain text (a description) → live nodes, whitespace kept. */
export function RichText({ text, ctx, className }) {
  if (!text) return null;
  return <div className={`${r.rich} ${className || ''}`}>{linkify(text, ctx)}</div>;
}
