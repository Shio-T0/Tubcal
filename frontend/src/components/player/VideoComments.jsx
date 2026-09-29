// A video's comments, drawn like a conversation rather than a dump: faces, the
// creator's own comments marked, the ones they hearted or pinned, likes, replies
// that open in place, Top or Newest, and more loading as you scroll. Timestamps in
// a comment seek the video; links to other videos open them in the player.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, ChevronDown, CornerDownRight, Heart, MessageSquare, Pin, ThumbsUp } from 'lucide-react';

import { api } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Spinner } from '../ui/index.jsx';
import { RichHtml } from './richText.jsx';
import w from './watch.module.css';

const LONG = 520; // characters of HTML past which a comment folds

function Author({ c, ctx }) {
  const name = c.author || 'someone';
  if (!c.author_id) return <span className={w.cAuthor}>{name}</span>;
  return (
    <button type="button" className={`${w.cAuthor} ${c.is_owner ? w.cOwner : ''}`} onClick={() => ctx.onChannel?.(c.author_id)} title="Open their channel">
      {name}
      {c.verified && <BadgeCheck size={13} className={w.cVerified} aria-label="verified" />}
    </button>
  );
}

function Comment({ c, ctx, videoId, channelName, channelFace }) {
  const [kids, setKids] = useState([]);
  const [token, setToken] = useState(c.reply_token || null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [folded, setFolded] = useState((c.body_html || '').length > LONG || (c.body_html || '').split('\n').length > 9);
  const replies = c.reply_count || 0;

  const more = async () => {
    if (!token || loading) return;
    setLoading(true);
    try {
      const res = await api(`/youtube/comments/${videoId}/replies?token=${encodeURIComponent(token)}&depth=${(c.depth ?? 0) + 1}`);
      setKids((k) => [...k, ...(res.comments || []).filter((x) => !k.some((y) => y.id === x.id))]);
      setToken(res.continuation || null);
      setOpen(true);
    } catch {
      /* the button stays, so it can be tried again */
    } finally {
      setLoading(false);
    }
  };
  const toggle = () => {
    if (!open && !kids.length) more();
    else setOpen((o) => !o);
  };

  return (
    <article className={`${w.comment} ${c.is_owner ? w.commentOwner : ''} ${c.depth ? w.reply : ''}`}>
      <Avatar src={c.author_thumb} name={(c.author || '?').replace(/^@/, '')} imgClass={w.cFace} letterClass={w.cLetter} />
      <div className={w.cBody}>
        {c.is_pinned && (
          <span className={w.cPinned}><Pin size={11} /> Pinned{channelName ? ` by ${channelName}` : ''}</span>
        )}
        <header className={w.cHead}>
          <Author c={c} ctx={ctx} />
          {c.is_owner && <span className={w.cBadge}>creator</span>}
          {c.member && <span className={`${w.cBadge} ${w.cMember}`}>member</span>}
          <time className={w.cTime}>{c.created_at ? timeAgo(c.created_at) : ''}{c.edited ? ' · edited' : ''}</time>
        </header>
        <div className={folded ? w.cFolded : undefined}>
          <RichHtml html={c.body_html} ctx={ctx} className={w.cText} />
        </div>
        {folded && (
          <button type="button" className={w.cMore} onClick={() => setFolded(false)}>Read more</button>
        )}
        <footer className={w.cFoot}>
          <span className={w.cLikes} title={c.score != null ? `${c.score} likes` : undefined}>
            <ThumbsUp size={13} /> {c.score ? compact(c.score) : ''}
          </span>
          {c.hearted && (
            <span className={w.cHeart} title={`Hearted by ${channelName || 'the creator'}`}>
              {channelFace ? <img src={channelFace} alt="" referrerPolicy="no-referrer" /> : null}
              <Heart size={11} fill="currentColor" />
            </span>
          )}
          {replies > 0 && (
            <button type="button" className={w.cReplies} onClick={toggle} disabled={loading} aria-expanded={open}>
              <ChevronDown size={14} className={open ? w.flip : ''} />
              {loading && !kids.length ? 'Loading…' : `${replies} ${replies === 1 ? 'reply' : 'replies'}`}
            </button>
          )}
        </footer>
        {open && kids.length > 0 && (
          <div className={w.cThread}>
            {kids.map((k) => (
              <Comment key={k.id} c={k} ctx={ctx} videoId={videoId} channelName={channelName} channelFace={channelFace} />
            ))}
            {token && (
              <button type="button" className={w.cReplies} onClick={more} disabled={loading}>
                <CornerDownRight size={13} /> {loading ? 'Loading…' : 'More replies'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function VideoComments({ videoId, total, ctx, scrollRoot, channelName, channelFace }) {
  const [sort, setSort] = useState('top');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sentinel = useRef(null);
  const busy = useRef(false);
  const run = useRef(0);

  const load = useCallback(async (cont) => {
    if (busy.current) return;
    busy.current = true;
    const mine = run.current;
    setLoading(true);
    try {
      const d = await api(`/youtube/comments/${videoId}?sort=${sort}${cont ? `&continuation=${encodeURIComponent(cont)}` : ''}`);
      if (mine !== run.current) return;
      setItems((prev) => {
        const base = cont ? prev : [];
        return [...base, ...(d.comments || []).filter((x) => !base.some((y) => y.id === x.id))];
      });
      setNext(d.continuation || null);
      if (d.count != null) setCount(d.count);
      setError(null);
    } catch (e) {
      if (mine === run.current) setError(e.message);
    } finally {
      busy.current = false;
      if (mine === run.current) setLoading(false);
    }
  }, [videoId, sort]);

  useEffect(() => {
    run.current += 1;
    busy.current = false;
    setItems([]);
    setNext(null);
    setError(null);
    load(null);
  }, [load]);

  // More as you near the bottom of the panel.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next) return undefined;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((x) => x.isIntersecting)) load(next); },
      { root: scrollRoot?.current || null, rootMargin: '500px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
    // `loading` too: the sentinel only exists once a page has finished loading.
  }, [next, load, scrollRoot, loading]);

  const shown = count ?? total;
  return (
    <section className={w.comments}>
      <div className={w.cBar}>
        <h3 className={w.cTitle}>
          <MessageSquare size={15} />
          {shown != null ? `${compact(shown)} comments` : 'Comments'}
        </h3>
        <div className={w.seg} role="group" aria-label="Order">
          {[['top', 'Top'], ['new', 'Newest']].map(([k, l]) => (
            <button key={k} type="button" className={sort === k ? w.segOn : ''} onClick={() => setSort(k)} aria-pressed={sort === k}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {items.map((c) => (
        <Comment key={c.id} c={c} ctx={ctx} videoId={videoId} channelName={channelName} channelFace={channelFace} />
      ))}

      {loading && <div className={w.center}><Spinner /></div>}
      {error && !items.length && <p className={w.empty}>Comments aren't reachable right now — {error}</p>}
      {!loading && !error && !items.length && <p className={w.empty}>No comments here — comments may be off for this video.</p>}
      {next && !loading && (
        <button type="button" ref={sentinel} className={w.cLoadMore} onClick={() => load(next)}>
          More comments
        </button>
      )}
      {!next && items.length > 0 && !loading && <p className={w.end}>That's every comment we could reach.</p>}
    </section>
  );
}
