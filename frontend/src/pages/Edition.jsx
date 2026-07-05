import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox, SectionHead } from '../components/layout/Section.jsx';
import HNCommentsPanel from '../components/modals/HNCommentsPanel.jsx';
import RedditPostModal from '../components/modals/RedditPostModal.jsx';
import { IconButton } from '../components/ui/index.jsx';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { usePlayer } from '../state.jsx';
import s from './edition.module.css';

const PLATFORM = {
  youtube: { color: 'var(--c-youtube)', glyph: '▶', tag: 'Screening Room' },
  reddit: { color: 'var(--c-reddit)', glyph: '◆', tag: 'The Dispatch' },
  hackernews: { color: 'var(--c-hn)', glyph: '⬢', tag: 'The Wire' },
};

function chipStat(item) {
  const bits = [];
  if (item.score != null) bits.push(`${compact(item.score)}▲`);
  if (item.comments_count != null) bits.push(`${compact(item.comments_count)} cmt`);
  return bits.join(' · ');
}

/** Pill row of every place a story appeared; each chip opens that item on its
 *  native surface (player / Reddit modal / HN panel). */
function SourceChips({ items, onOpen, compact: small }) {
  const [expanded, setExpanded] = useState(false);
  const cap = small ? 2 : 4;
  const shown = expanded ? items : items.slice(0, cap);
  const extra = items.length - shown.length;
  return (
    <div className={s.chips}>
      {shown.map((it) => {
        const p = PLATFORM[it.platform] || PLATFORM.hackernews;
        const stat = chipStat(it);
        return (
          <button
            key={it.id}
            className={s.chip}
            style={{ '--chip-c': p.color }}
            title={`${it.title} — open in ${p.tag}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(it);
            }}
          >
            <span className={s.chipGlyph}>{p.glyph}</span>
            <span className={s.chipLabel}>{it.source}</span>
            {!small && stat && <span className={s.chipStat}>{stat}</span>}
            {small && it.score != null && (
              <span className={s.chipStat}>{compact(it.score)}▲</span>
            )}
          </button>
        );
      })}
      {extra > 0 && (
        <button
          className={`${s.chip} ${s.chipMore}`}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          +{extra} more
        </button>
      )}
    </div>
  );
}

function datelineDate(iso) {
  return new Date(`${iso}T00:00:00`)
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase();
}

function Dateline({ paper, recomposing }) {
  const seg = [`VOL. I · No ${paper.issue}`, datelineDate(paper.date)];
  seg.push(
    paper.status === 'edited'
      ? `COMPILED LOCALLY · ${(paper.model || '').toUpperCase()}`
      : 'WIRE EDITION — PRESSES COLD',
  );
  seg.push(`${paper.sources} SOURCES · ${(paper.build_ms / 1000).toFixed(1)}s`);
  return (
    <div className={s.dateline}>
      <span className={paper.status === 'wire' ? s.datelineWire : undefined}>
        {seg.join('  —  ')}
      </span>
      {recomposing && <span className={s.recomposing}>RECOMPOSING…</span>}
    </div>
  );
}

function Lede({ story, onOpen }) {
  const items = story.items || [];
  const hero = items.find((i) => i.thumbnail);
  const [imgOk, setImgOk] = useState(true);
  const top = items[0];
  const p = PLATFORM[top?.platform] || PLATFORM.hackernews;
  return (
    <article
      className={`${s.lede} ${hero && imgOk ? '' : s.ledeNoImage}`}
      style={{ '--story-c': p.color }}
      onClick={() => top && onOpen(top)}
      data-kbd-tile
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && top) {
          e.preventDefault();
          onOpen(top);
        }
      }}
    >
      <div className={s.ledeText}>
        <span className={s.slug}>Lead story</span>
        <h2 className={s.ledeHeadline}>{story.headline}</h2>
        {story.dek && <p className={s.dek}>{story.dek}</p>}
        {story.body && (
          <p className={`${s.body} ${story.synthesized ? s.bodyEdited : s.bodyWire}`}>
            {story.body}
          </p>
        )}
        <SourceChips items={items} onOpen={onOpen} />
      </div>
      {hero && imgOk && (
        <div className={s.ledeImageWrap}>
          <img
            className={s.ledeImage}
            src={hero.thumbnail}
            alt=""
            fetchPriority="high"
            decoding="async"
            onError={() => setImgOk(false)}
          />
        </div>
      )}
    </article>
  );
}

function ColumnStory({ story, index, onOpen }) {
  const items = story.items || [];
  const top = items[0];
  const p = PLATFORM[top?.platform] || PLATFORM.hackernews;
  return (
    <article
      className={s.column}
      style={{ '--i': index, '--story-c': p.color }}
      onClick={() => top && onOpen(top)}
      data-kbd-tile
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && top) {
          e.preventDefault();
          onOpen(top);
        }
      }}
    >
      <h3 className={s.colHeadline}>{story.headline}</h3>
      {(story.dek || story.body) && (
        <p className={s.colDek}>{story.dek || story.body}</p>
      )}
      <SourceChips items={items} onOpen={onOpen} compact />
    </article>
  );
}

function Brief({ brief, index, onOpen }) {
  const top = (brief.items || [])[0];
  const p = PLATFORM[top?.platform] || PLATFORM.hackernews;
  return (
    <button
      className={s.brief}
      style={{ '--i': index, '--story-c': p.color }}
      onClick={() => top && onOpen(top)}
      data-kbd-tile
    >
      <span className={s.briefMark}>▸</span>
      <span className={s.briefHeadline}>{brief.headline}</span>
      <span className={s.briefMeta}>
        {' — '}
        {top?.source}
        {top?.published_at ? ` · ${timeAgo(top.published_at)}` : ''}
      </span>
    </button>
  );
}

function PressesWarming({ hour, onCompose, composing }) {
  return (
    <div className={`glass ${s.warming}`}>
      <span className={s.warmingSlug}>
        <span className={s.warmingDot} />
        THE PRESSES ARE WARMING
      </span>
      <p className={s.warmingLine}>
        Your first edition is composed from today&rsquo;s signals
        {hour != null ? ` after ${String(hour).padStart(2, '0')}:00` : ''}.
      </p>
      <button className={s.warmingBtn} onClick={onCompose} disabled={composing}>
        {composing ? 'Composing…' : 'Compose now'}
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden>
      <div className={s.skelDateline} />
      <div className={s.skelLede}>
        <div>
          <div className={s.skelBar} style={{ width: '38%' }} />
          <div className={s.skelHead} />
          <div className={s.skelHead} style={{ width: '70%' }} />
          <div className={s.skelBar} style={{ width: '90%' }} />
          <div className={s.skelBar} style={{ width: '84%' }} />
        </div>
        <div className={s.skelImage} />
      </div>
      <div className={s.skelCols}>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className={s.skelBar} style={{ width: '85%' }} />
            <div className={s.skelBar} style={{ width: '60%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Edition() {
  const [dateSel, setDateSel] = useState(null); // null = latest
  const paperReq = useApi(dateSel ? `/edition/${dateSel}` : '/edition/latest');
  const { open: playVideo } = usePlayer();
  const [post, setPost] = useState(null);
  const [thread, setThread] = useState(null);
  const [recomposing, setRecomposing] = useState(false);
  const [buildHour, setBuildHour] = useState(null);
  const archiveRef = useRef(null); // [{date,...}] newest-first, fetched lazily

  const paper = paperReq.data;
  const noPaper = paperReq.error === 'no edition yet';

  const openItem = (item) => {
    if (item.platform === 'youtube') playVideo(item);
    else if (item.platform === 'reddit') setPost(item);
    else setThread(item);
  };

  const recompose = async () => {
    try {
      await api('/edition/rebuild', { method: 'POST' });
      setRecomposing(true);
    } catch {
      /* best-effort */
    }
  };

  // While a build is in flight (or the first paper hasn't landed), watch the
  // presses; when they stop, the fresh paper cross-fades in via the key below.
  const reload = paperReq.reload;
  useEffect(() => {
    if (!recomposing && !noPaper) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const st = await api('/edition/status');
        if (!alive) return;
        if (st.hour != null) setBuildHour(st.hour);
        if (!st.building && st.latest) {
          setRecomposing(false);
          reload();
        }
      } catch {
        /* keep watching */
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [recomposing, noPaper, reload]);

  // Yesterday / tomorrow via the (lazily fetched, meta-only) archive list.
  const step = useCallback(
    async (dir) => {
      if (!archiveRef.current) {
        try {
          archiveRef.current = (await api('/edition/archive')).editions;
        } catch {
          return;
        }
      }
      const dates = archiveRef.current.map((e) => e.date);
      const cur = paper?.date;
      const idx = dates.indexOf(cur);
      if (idx < 0) return;
      const nextIdx = idx + (dir === 'prev' ? 1 : -1);
      if (nextIdx < 0 || nextIdx >= dates.length) return;
      setDateSel(nextIdx === 0 ? null : dates[nextIdx]);
    },
    [paper?.date],
  );

  const isLatest = dateSel === null;

  return (
    <>
      <SectionHead
        kicker="No 00 — The Edition"
        title="Today’s paper, set on this machine"
        note="One paper from every room of the station — the same story found across platforms, compiled locally."
        color="var(--c-foryou)"
      >
        {isLatest && paper && (
          <IconButton title="Recompose" onClick={recompose} spinning={recomposing}>
            <RefreshCw size={16} />
          </IconButton>
        )}
      </SectionHead>

      {paperReq.error && !noPaper && <ErrorBox message={paperReq.error} />}
      {noPaper && (
        <PressesWarming hour={buildHour} onCompose={recompose} composing={recomposing} />
      )}
      {paperReq.loading && !paper && !noPaper && <Skeleton />}

      {paper && (
        <div key={paper.generated_at} className={s.paper}>
          <Dateline paper={paper} recomposing={recomposing && isLatest} />

          {paper.lede && <Lede story={paper.lede} onOpen={openItem} />}

          {paper.columns?.length > 0 && (
            <div className={s.columns}>
              {paper.columns.map((story, i) => (
                <ColumnStory
                  key={story.items?.[0]?.id || i}
                  story={story}
                  index={i}
                  onOpen={openItem}
                />
              ))}
            </div>
          )}

          {paper.briefs?.length > 0 && (
            <section className={s.briefsBlock}>
              <span className={s.briefsSlug}>In brief</span>
              <div className={s.briefs}>
                {paper.briefs.map((b, i) => (
                  <Brief key={b.items?.[0]?.id || i} brief={b} index={i} onOpen={openItem} />
                ))}
              </div>
            </section>
          )}

          <footer className={s.colophon}>
            <button
              className={s.colophonNav}
              onClick={() => step('prev')}
              title="Read the previous edition"
            >
              ← Yesterday’s paper
            </button>
            <span className={s.colophonText}>
              Set in Fraunces &amp; Schibsted Grotesk ·{' '}
              {paper.status === 'edited'
                ? `composed by ${paper.model}`
                : 'composed from the wire'}{' '}
              · nothing left this machine
            </span>
            <button
              className={s.colophonNav}
              onClick={() => step('next')}
              disabled={isLatest}
              title={isLatest ? 'This is the latest edition' : 'Read the next edition'}
            >
              Tomorrow →
            </button>
          </footer>
        </div>
      )}

      <RedditPostModal item={post} onClose={() => setPost(null)} />
      <HNCommentsPanel item={thread} onClose={() => setThread(null)} />
    </>
  );
}
