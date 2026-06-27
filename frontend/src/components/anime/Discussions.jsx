import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  CalendarClock, Eye, Heart, Layers, Lock, Megaphone, MessageCircle, MessageSquare,
  Pin, Search, Send, Sparkles, Tv, Users, X,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { Receiving, useDebounced } from '../layout/Section.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { Button } from '../ui/index.jsx';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { useToast } from '../../state.jsx';
import { ProfileModal } from './Profile.jsx';
import c from './discussions.module.css';

// ── shared bits ──────────────────────────────────────────────────────────────

/** A username that opens its AniList profile. stopPropagation so it never also
 *  triggers the thread row it sits inside. */
function UserChip({ name, avatar, className }) {
  const [open, setOpen] = useState(false);
  if (!name) return null;
  return (
    <>
      <button
        className={`${c.userChip} ${className || ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <Avatar src={avatar} name={name} imgClass={c.av} letterClass={c.avL} />
        <span>{name}</span>
      </button>
      {open && <ProfileModal name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

// AniList renders its markdown to a small, safe HTML subset. We still sanitize it
// to a strict allow-list before injecting (drop unknown/unsafe tags + attributes,
// force safe link/img schemes), then style it and make spoilers click-to-reveal.
const ALLOWED_TAGS = {
  A: ['href'], P: [], BR: [], STRONG: [], B: [], EM: [], I: [], DEL: [], S: [], U: [],
  UL: [], OL: [], LI: [], BLOCKQUOTE: [], CODE: [], PRE: [], HR: [],
  H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], DIV: [], CENTER: [], IMG: ['src'],
  SPAN: ['class'],
};
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function sanitizeAniHtml(html) {
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
  MEDIA_LINK_RE.lastIndex = 0;
  while ((m = MEDIA_LINK_RE.exec(html))) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind: m[1], id: Number(m[2]), url: m[0] });
    }
  }
  return out.slice(0, 4);
}

/** A cover + title preview for a linked AniList title. Anime open in-app; manga
 *  (no detail page here) opens on AniList. */
function MediaLinkCard({ id, kind, url }) {
  const card = useApi(`/anime/media_card/${id}`);
  const m = card.data;
  if (!m) return null;
  const meta = [m.type === 'MANGA' ? 'Manga' : 'Anime', m.format, m.year].filter(Boolean).join(' · ');
  const inner = (
    <>
      {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <span className={c.lcFallback}><Tv size={16} /></span>}
      <span className={c.lcMeta}>
        <span className={c.lcKicker}>{meta}</span>
        <span className={c.lcTitle}>{m.title}</span>
      </span>
    </>
  );
  return m.type === 'ANIME'
    ? <Link to={`/anime/${m.id}`} className={c.linkCard} onClick={(e) => e.stopPropagation()}>{inner}</Link>
    : <a href={url} target="_blank" rel="noreferrer" className={c.linkCard} onClick={(e) => e.stopPropagation()}>{inner}</a>;
}

/** Renders AniList's HTML body/comment: sanitized, styled, with click-to-reveal
 *  spoilers (delegated so it works on injected markup) and AniList link previews. */
function AniHtml({ html, className }) {
  const clean = useMemo(() => (html ? sanitizeAniHtml(html) : ''), [html]);
  const links = useMemo(() => extractMediaLinks(clean), [clean]);
  if (!clean) return null;
  const reveal = (e) => {
    const sp = e.target.closest?.('.markdown_spoiler');
    if (sp && !sp.classList.contains('revealed')) {
      e.stopPropagation();
      sp.classList.add('revealed');
    }
  };
  return (
    <>
      <div
        className={`${c.rich} ${className || ''}`}
        onClick={reveal}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {links.length > 0 && (
        <div className={c.linkCards}>
          {links.map((l) => <MediaLinkCard key={`${l.kind}:${l.id}`} {...l} />)}
        </div>
      )}
    </>
  );
}

function LikeButton({ id, type, liked, likes }) {
  const toast = useToast();
  const [on, setOn] = useState(!!liked);
  const [n, setN] = useState(likes || 0);
  const [busy, setBusy] = useState(false);
  const toggle = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await api('/anime/like', { method: 'POST', body: JSON.stringify({ id, type }) });
      setN((x) => x + (on ? -1 : 1));
      setOn((o) => !o);
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <button className={`${c.like} ${on ? c.likeOn : ''}`} onClick={toggle} disabled={busy}>
      <Heart size={12} fill={on ? 'currentColor' : 'none'} /> {n > 0 ? compact(n) : ''}
    </button>
  );
}

function Composer({ placeholder, label, onSubmit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const done = await onSubmit(text.trim());
    setBusy(false);
    if (done) setText('');
  };
  return (
    <div className={c.composer}>
      <textarea
        className={c.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
      />
      <Button onClick={submit} disabled={busy || !text.trim()}>
        <Send size={13} /> {label}
      </Button>
    </div>
  );
}

// ── forum: categories ────────────────────────────────────────────────────────

// Curated top-level categories mapped to real AniList forum category ids.
// `media` = supports an anime sub-category; `spoiler` = supports the spoiler filter.
const CATEGORIES = [
  { key: 'all', cat: null, label: 'All', desc: 'Every thread, most recently active first', Icon: Layers },
  { key: 'anilist', cat: 13, label: 'AniList', desc: "AniList's own site announcements", Icon: Megaphone },
  { key: 'anime', cat: 1, label: 'Anime', desc: 'Open anime discussion — pick a title to narrow it', Icon: Tv, media: true, spoiler: true },
  { key: 'recs', cat: 15, label: 'Recommendations', desc: 'Ask for and share what to watch next', Icon: Sparkles },
  { key: 'releases', cat: 5, label: 'Releases', desc: 'New episodes and seasonal release talk', Icon: CalendarClock, spoiler: true },
  { key: 'meetups', cat: 16, label: 'Meetups & Games', desc: 'Community games, watch-alongs and meetups', Icon: Users },
  { key: 'general', cat: 7, label: 'General', desc: 'Off-topic and everything else', Icon: MessageCircle },
];

const SPOILER_MODES = [
  { v: 'all', label: 'All' },
  { v: 'safe', label: 'No spoilers' },
  { v: 'only', label: 'Spoilers' },
];

/** Compact title combobox → picks an anime as the active sub-category. */
function MediaPicker({ onPick }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useApi(`/anime/search?q=${encodeURIComponent(dq)}`, dq.trim().length > 1);
  const items = (res.data?.items || []).slice(0, 6);
  return (
    <div className={c.picker}>
      <Tv size={13} />
      <input
        className={c.pickerInput}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="filter by a title…"
      />
      {dq.trim().length > 1 && items.length > 0 && (
        <div className={c.pickerMenu}>
          {items.map((m) => (
            <button
              key={m.id}
              className={c.pickerItem}
              onMouseDown={() => { onPick({ id: m.id, title: m.title, cover: m.cover }); setQ(''); }}
            >
              {m.cover && <img src={m.cover} alt="" />}
              <span>{m.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ t, onOpen }) {
  const tags = (t.categories || []).filter((x) => x.id !== 1).slice(0, 2);
  return (
    <article className={c.thread} onClick={onOpen}>
      <div className={c.threadMain}>
        <div className={c.threadTop}>
          {t.sticky && <span className={c.badgePin}><Pin size={11} /> Pinned</span>}
          {t.locked && <span className={c.badgeLock}><Lock size={11} /></span>}
          <h3 className={c.threadTitle}>{t.title}</h3>
          {t.spoiler && <span className={c.badgeSpoiler}>Spoilers</span>}
        </div>
        {t.snippet && <p className={c.threadSnippet}>{t.snippet}</p>}
        <div className={c.threadFoot}>
          <UserChip name={t.user.name} avatar={t.user.avatar} />
          <span className={c.threadStat}><MessageSquare size={12} /> {compact(t.replies || 0)}</span>
          <span className={c.threadStat}><Eye size={12} /> {compact(t.views || 0)}</span>
          {t.replied_at && <span className={c.threadTime}>{timeAgo(t.replied_at)}</span>}
          {tags.map((x) => <span key={x.id} className={c.tag}>{x.name}</span>)}
        </div>
      </div>
      {t.media?.cover && (
        <img className={c.threadCover} src={t.media.cover} alt="" loading="lazy" title={t.media.title} />
      )}
    </article>
  );
}

// Total comments incl. nested replies — for the "N replies" header.
function countComments(list) {
  return (list || []).reduce((n, cm) => n + 1 + countComments(cm.children), 0);
}

/** One comment and its nested replies, each with its own reply box. */
function CommentNode({ cm, depth, locked, onReply }) {
  const [replying, setReplying] = useState(false);
  const submit = async (text) => {
    const done = await onReply(text, cm.id);
    if (done) setReplying(false);
    return done;
  };
  return (
    <div className={`${c.comment} ${depth > 0 ? c.commentNested : ''}`}>
      <UserChip name={cm.user.name} avatar={cm.user.avatar} className={c.commentAvatarOnly} />
      <div className={c.commentBody}>
        <div className={c.commentHead}>
          <UserChip name={cm.user.name} avatar={cm.user.avatar} className={c.commentNameOnly} />
          <span className={c.time}>{timeAgo(cm.created_at)}</span>
        </div>
        <AniHtml html={cm.comment} className={c.commentText} />
        <div className={c.commentActions}>
          <LikeButton id={cm.id} type="THREAD_COMMENT" liked={cm.liked} likes={cm.likes} />
          {!locked && (
            <button className={c.reBtn} onClick={() => setReplying((r) => !r)}>
              <MessageSquare size={12} /> Reply
            </button>
          )}
        </div>
        {replying && (
          <Composer placeholder={`Reply to ${cm.user.name}…`} label="Reply" onSubmit={submit} />
        )}
        {cm.children?.length > 0 && (
          <div className={c.replies}>
            {cm.children.map((ch) => (
              <CommentNode key={ch.id} cm={ch} depth={depth + 1} locked={locked} onReply={onReply} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadModal({ threadId, onClose }) {
  const data = useApi(`/anime/thread/${threadId}`);
  const toast = useToast();
  const th = data.data?.thread;
  const comments = data.data?.comments || [];

  const postComment = async (text, parentId = null) => {
    try {
      await api(`/anime/thread/${threadId}/comment`, {
        method: 'POST',
        body: JSON.stringify({ text, parent_id: parentId }),
      });
      toast(parentId ? 'Reply posted to AniList' : 'Comment posted to AniList', 'success');
      data.reload();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const total = countComments(comments);

  return createPortal(
    <div className={c.overlay} onMouseDown={onClose}>
      <div className={c.modal} onMouseDown={(e) => e.stopPropagation()}>
        <button className={c.close} onClick={onClose} aria-label="Close"><X size={18} /></button>
        {data.loading && !data.data && <Receiving label="loading thread" />}
        {th && (
          <>
            <div className={c.modalHead}>
              {(th.media || th.categories?.length > 0) && (
                <div className={c.threadTags}>
                  {th.media && (
                    <Link to={`/anime/${th.media.id}`} className={c.mediaTag} onClick={onClose}>
                      {th.media.cover && <img src={th.media.cover} alt="" />}
                      {th.media.title}
                    </Link>
                  )}
                  {(th.categories || []).map((x) => <span key={x.id} className={c.tag}>{x.name}</span>)}
                  {th.locked && <span className={c.badgeLock}><Lock size={11} /> Locked</span>}
                </div>
              )}
              <h2 className={c.modalTitle}>{th.title}</h2>
              <div className={c.byline}>
                <UserChip name={th.user.name} avatar={th.user.avatar} />
                <span className={c.dot}>·</span>
                <span>{timeAgo(th.created_at)}</span>
                <span className={c.bylineStats}>
                  <span><MessageSquare size={12} /> {compact(th.replies || 0)}</span>
                  <span><Eye size={12} /> {compact(th.views || 0)}</span>
                </span>
              </div>
            </div>

            {th.body && <AniHtml html={th.body} className={c.body} />}

            {!th.locked && (
              <div className={c.replyBox}>
                <Composer placeholder="Add a comment…" label="Comment" onSubmit={(t) => postComment(t, null)} />
              </div>
            )}

            <div className={c.commentsHead}>
              {total > 0 ? `${total} repl${total === 1 ? 'y' : 'ies'}` : 'No replies yet — be the first.'}
            </div>
            <div className={c.comments}>
              {comments.map((cm) => (
                <CommentNode key={cm.id} cm={cm} depth={0} locked={th.locked} onReply={postComment} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Per-anime discussion (used on the detail page) — threads filed under one title. */
function MediaThreads({ mediaId }) {
  const threads = useApi(`/anime/threads?media_id=${mediaId}`);
  const [openId, setOpenId] = useState(null);
  const items = threads.data?.items || [];
  if (threads.loading && !threads.data) return <Receiving label="opening discussion" />;
  if (threads.error) return <p className={c.muted}>Couldn't load threads.</p>;
  if (!items.length) return <p className={c.muted}>No threads about this title yet.</p>;
  return (
    <>
      <div className={c.threadList}>
        {items.map((t) => <ThreadRow key={t.id} t={t} onOpen={() => setOpenId(t.id)} />)}
      </div>
      {openId && <ThreadModal threadId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** The full forum: category rail, sub-category (title) + spoiler filters, thread list. */
function Forum() {
  const [catKey, setCatKey] = useState('all');
  const [media, setMedia] = useState(null);
  const [spoiler, setSpoiler] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [openId, setOpenId] = useState(null);

  const cat = CATEGORIES.find((x) => x.key === catKey) || CATEGORIES[0];
  const params = new URLSearchParams();
  if (cat.cat) params.set('category', cat.cat);
  if (cat.media && media) params.set('media_id', media.id);
  if (cat.spoiler && spoiler !== 'all') params.set('spoiler', spoiler);
  if (dq.trim()) params.set('q', dq.trim());
  const threads = useApi(`/anime/threads?${params.toString()}`);
  const items = threads.data?.items || [];

  const pick = (key) => { setCatKey(key); setMedia(null); setSpoiler('all'); };

  return (
    <div className={c.forum}>
      <nav className={c.catRail}>
        {CATEGORIES.map((x) => (
          <button
            key={x.key}
            className={`${c.catChip} ${x.key === catKey ? c.catChipOn : ''}`}
            onClick={() => pick(x.key)}
          >
            <x.Icon size={14} /> {x.label}
          </button>
        ))}
      </nav>

      <div className={c.forumBar}>
        <p className={c.forumDesc}><cat.Icon size={14} /> {cat.desc}</p>
        <div className={c.forumFilters}>
          {cat.media && !media && <MediaPicker onPick={setMedia} />}
          {cat.spoiler && (
            <div className={c.spoilTabs}>
              {SPOILER_MODES.map((m) => (
                <button
                  key={m.v}
                  className={spoiler === m.v ? c.spoilOn : ''}
                  onClick={() => setSpoiler(m.v)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <div className={c.searchMini}>
            <Search size={13} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search threads…" />
          </div>
        </div>
      </div>

      {media && (
        <div className={c.subcat}>
          {media.cover && <img src={media.cover} alt="" />}
          <span>Sub-category · <strong>{media.title}</strong></span>
          <button onClick={() => setMedia(null)} aria-label="Clear sub-category"><X size={12} /></button>
        </div>
      )}

      {threads.loading && !threads.data && <Receiving label="opening the forum" />}
      {threads.error && <p className={c.muted}>Couldn't load threads.</p>}
      {!threads.loading && !items.length && <p className={c.muted}>No threads match this filter yet.</p>}

      <div className={c.threadList}>
        {items.map((t) => <ThreadRow key={t.id} t={t} onOpen={() => setOpenId(t.id)} />)}
      </div>
      {openId && <ThreadModal threadId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export function ForumList({ mediaId }) {
  return mediaId ? <MediaThreads mediaId={mediaId} /> : <Forum />;
}

// ── activity feed ────────────────────────────────────────────────────────────

function ActivityCard({ a }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const reply = async (text) => {
    try {
      await api(`/anime/activity/${a.id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
      toast('Reply posted to AniList', 'success');
      setReplying(false);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  return (
    <div className={c.activity}>
      <UserChip name={a.user.name} avatar={a.user.avatar} className={c.commentAvatarOnly} />
      <div className={c.activityBody}>
        <div className={c.commentHead}>
          <UserChip name={a.user.name} avatar={a.user.avatar} className={c.commentNameOnly} />
          <span className={c.time}>{timeAgo(a.created_at)}</span>
        </div>
        {a.kind === 'TextActivity' ? (
          <AniHtml html={a.text} className={c.commentText} />
        ) : (
          <div className={c.commentText}>
            {a.status}{a.progress ? ` ${a.progress} of` : ''}{' '}
            {a.media?.id ? (
              <Link to={`/anime/${a.media.id}`} className={c.aLink}>{a.media.title}</Link>
            ) : (
              a.media?.title
            )}
          </div>
        )}
        <div className={c.activityActions}>
          <LikeButton id={a.id} type="ACTIVITY" liked={a.liked} likes={a.likes} />
          <button className={c.reBtn} onClick={() => setReplying((r) => !r)}>
            <MessageSquare size={12} /> {a.replies > 0 ? compact(a.replies) : 'Reply'}
          </button>
        </div>
        {replying && <Composer placeholder="Write a reply…" label="Reply" onSubmit={reply} />}
      </div>
    </div>
  );
}

export function ActivityFeed({ mediaId }) {
  const feed = useApi(`/anime/activity${mediaId ? `?media_id=${mediaId}` : ''}`);
  const toast = useToast();
  const post = async (text) => {
    try {
      await api('/anime/activity', { method: 'POST', body: JSON.stringify({ text }) });
      toast('Posted to AniList', 'success');
      feed.reload();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const items = feed.data?.items || [];
  return (
    <div className={c.feed}>
      {!mediaId && <Composer placeholder="Share a status with AniList…" label="Post" onSubmit={post} />}
      {feed.loading && !feed.data && <Receiving label="loading activity" />}
      {feed.error && <p className={c.muted}>Couldn't load activity.</p>}
      {items.map((a) => <ActivityCard key={a.id} a={a} />)}
    </div>
  );
}
