// AniList's rendered HTML (thread bodies, comments, activity, bios, and the live
// previews in the composer), shown safely.
//
// AniList renders its markdown to a small HTML subset. It's still sanitised here
// against a strict allow-list before it touches the DOM: unknown tags become
// their text, attributes are dropped unless allowed, and links/images must be
// http(s). Spoilers stay veiled until clicked, and AniList title links grow a
// small cover card beneath the text.

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Tv } from 'lucide-react';

import { useApi } from '../../api/client.js';
import r from './richtext.module.css';

const ALLOWED_TAGS = {
  A: ['href'], P: [], BR: [], STRONG: [], B: [], EM: [], I: [], DEL: [], S: [], U: [],
  UL: [], OL: [], LI: [], BLOCKQUOTE: [], CODE: [], PRE: [], HR: [],
  H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], DIV: [], CENTER: [], IMG: ['src', 'width'],
  SPAN: ['class'],
};
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

export function sanitizeAniHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const walk = (node) => {
    [...node.childNodes].forEach((ch) => {
      if (ch.nodeType === 3) return; // text node — keep
      if (ch.nodeType !== 1) { ch.remove(); return; }
      const allowed = ALLOWED_TAGS[ch.tagName];
      if (!allowed) { ch.replaceWith(doc.createTextNode(ch.textContent || '')); return; }
      [...ch.attributes].forEach((at) => {
        const name = at.name.toLowerCase();
        if (!allowed.includes(name)) { ch.removeAttribute(at.name); return; }
        if ((name === 'href' || name === 'src') && !SAFE_URL.test(at.value.trim())) {
          ch.removeAttribute(at.name);
        }
        if (name === 'width' && !/^\d{1,4}%?$/.test(at.value)) ch.removeAttribute(at.name);
        if (name === 'class') {
          if (/\bmarkdown_spoiler\b/.test(at.value)) ch.setAttribute('class', 'markdown_spoiler');
          else ch.removeAttribute('class');
        }
      });
      if (ch.tagName === 'A') { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noreferrer'); }
      if (ch.tagName === 'IMG') {
        if (!ch.getAttribute('src')) { ch.remove(); return; }
        ch.setAttribute('loading', 'lazy');
      }
      walk(ch);
    });
  };
  walk(root);
  return root.innerHTML;
}

// Pull AniList media links out of a body so we can show a cover + title preview.
const MEDIA_LINK_RE = /https?:\/\/anilist\.co\/(anime|manga)\/(\d+)/gi;
function extractMediaLinks(html) {
  const seen = new Set();
  const out = [];
  let m;
  const re = new RegExp(MEDIA_LINK_RE.source, 'gi');
  while ((m = re.exec(html))) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind: m[1], id: Number(m[2]), url: m[0] });
    }
  }
  return out.slice(0, 4);
}

/** A cover + title preview for a linked AniList title. Anime open in-app; manga
 *  (no page here) open on AniList. */
function MediaLinkCard({ id, url }) {
  const card = useApi(`/anime/media_card/${id}`);
  const m = card.data;
  if (!m) return null;
  const meta = [m.type === 'MANGA' ? 'Manga' : 'Anime', m.format, m.year].filter(Boolean).join(' · ');
  const inner = (
    <>
      {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <span className={r.lcFallback}><Tv size={16} /></span>}
      <span className={r.lcMeta}>
        <span className={r.lcKicker}>{meta}</span>
        <span className={r.lcTitle}>{m.title}</span>
      </span>
    </>
  );
  return m.type === 'ANIME'
    ? <Link to={`/anime/${m.id}`} className={r.linkCard} onClick={(e) => e.stopPropagation()}>{inner}</Link>
    : <a href={url} target="_blank" rel="noreferrer" className={r.linkCard} onClick={(e) => e.stopPropagation()}>{inner}</a>;
}

// AniList links that have a page here open in-app instead of on anilist.co:
// people (and @mentions), anime, threads, characters, voices and studios.
const IN_APP = [
  [/^https?:\/\/anilist\.co\/user\/([^/?#]+)/i, (m) => `/anime/user/${m[1]}`],
  [/^https?:\/\/anilist\.co\/anime\/(\d+)/i, (m) => `/anime/${m[1]}`],
  [/^https?:\/\/anilist\.co\/forum\/thread\/(\d+)/i, (m) => `/anime/thread/${m[1]}`],
  [/^https?:\/\/anilist\.co\/character\/(\d+)/i, (m) => `/anime/character/${m[1]}`],
  [/^https?:\/\/anilist\.co\/staff\/(\d+)/i, (m) => `/anime/voice/${m[1]}`],
  [/^https?:\/\/anilist\.co\/studio\/(\d+)/i, (m) => `/anime/studio/${m[1]}`],
];
export function inAppHref(href) {
  for (const [re, to] of IN_APP) {
    const m = (href || '').match(re);
    if (m) return to(m);
  }
  return null;
}

/** Renders AniList's HTML: sanitised, styled, click-to-reveal spoilers (delegated,
 *  so they work on injected markup), in-app links, and title link previews.
 *  `cards={false}` skips the previews (the live composer preview re-renders on
 *  every keystroke). */
export function AniHtml({ html, className, cards = true }) {
  const navigate = useNavigate();
  const clean = useMemo(() => (html ? sanitizeAniHtml(html) : ''), [html]);
  const links = useMemo(() => (cards ? extractMediaLinks(clean) : []), [clean, cards]);
  if (!clean) return null;
  const reveal = (e) => {
    const sp = e.target.closest?.('.markdown_spoiler');
    if (sp && !sp.classList.contains('revealed')) {
      e.stopPropagation();
      e.preventDefault(); // a link inside a veiled spoiler shouldn't fire on the reveal click
      sp.classList.add('revealed');
      return;
    }
    const a = e.target.closest?.('a[href]');
    const to = a && !e.metaKey && !e.ctrlKey && !e.shiftKey && inAppHref(a.getAttribute('href'));
    if (to) {
      e.preventDefault();
      e.stopPropagation();
      navigate(to);
    }
  };
  return (
    <>
      <div
        className={`${r.rich} ${className || ''}`}
        onClick={reveal}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {links.length > 0 && (
        <div className={r.linkCards}>
          {links.map((l) => <MediaLinkCard key={`${l.kind}:${l.id}`} {...l} />)}
        </div>
      )}
    </>
  );
}
