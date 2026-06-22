import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clapperboard, Minus, Play, Plus, Star, ThumbsUp, Tv } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import {
  ErrorBox,
  Receiving,
  SearchBar,
  SectionHead,
  useDebounced,
} from '../components/layout/Section.jsx';
import { Button, EmptyState, SegmentedControl } from '../components/ui/index.jsx';
import { ActivityFeed, ForumList } from '../components/anime/Discussions.jsx';
import { useHorizontalWheel } from '../lib/useHorizontalWheel.js';
import { usePlayer, useToast } from '../state.jsx';
import s from './anime.module.css';

// AniList score scales by the viewer's chosen format.
const SCORE_MAX = { POINT_100: 100, POINT_10_DECIMAL: 10, POINT_10: 10, POINT_5: 5, POINT_3: 3 };
const SCORE_STEP = { POINT_10_DECIMAL: 0.5 };

const ACCENT = { '--accent-local': 'var(--c-anime)' };

// AniList averageScore is 0–100; show it as a tidy percent.
function scoreLabel(n) {
  return n ? `${n}%` : null;
}

function metaLine(m) {
  const bits = [];
  if (m.format) bits.push(m.format);
  if (m.episodes) bits.push(`${m.episodes} ep`);
  if (m.year) bits.push(m.year);
  return bits.join(' · ');
}

/** A trailer plays through Tubcal's existing YouTube player (AniList stores a YT id). */
export function trailerItem(media) {
  const tr = media.trailer;
  if (!tr || tr.site !== 'youtube') return null;
  return {
    id: `yt:${tr.id}`,
    platform: 'youtube',
    title: `${media.title} — Trailer`,
    url: `https://www.youtube.com/watch?v=${tr.id}`,
    thumbnail: tr.thumbnail,
    source: media.title,
    published_at: 0,
    extra: { video_id: tr.id },
  };
}

export function AnimeCard({ media, corner }) {
  return (
    <Link to={`/anime/${media.id}`} className={s.card} style={{ '--cover-c': media.color || 'var(--c-anime)' }}>
      <div className={s.cardCoverWrap}>
        {media.cover ? (
          <img className={s.cardCover} src={media.cover} alt="" loading="lazy" />
        ) : (
          <div className={s.cardCoverFallback}><Tv size={26} /></div>
        )}
        {corner && <span className={s.cardCorner}>{corner}</span>}
        {scoreLabel(media.score) && (
          <span className={s.cardScore}><Star size={11} fill="currentColor" /> {scoreLabel(media.score)}</span>
        )}
      </div>
      <div className={s.cardTitle}>{media.title}</div>
      <div className={s.cardMeta}>{metaLine(media)}</div>
    </Link>
  );
}

function Grid({ items }) {
  return (
    <div className={s.grid}>
      {items.map((m) => (
        <AnimeCard key={m.id} media={m} />
      ))}
    </div>
  );
}

function BrowseTab() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('trending');
  const q = query.trim();
  const dq = useDebounced(q);
  const searching = dq.length > 0;

  const search = useApi(`/anime/search?q=${encodeURIComponent(dq)}`, searching);
  const browse = useApi(`/anime/browse?kind=${kind}`, !searching);

  const active = searching ? search : browse;
  const items = active.data?.items || [];

  return (
    <>
      <SearchBar value={query} onChange={setQuery} placeholder="search AniList…" />
      {!searching && (
        <div className={s.browseBar}>
          <SegmentedControl
            options={[
              { value: 'trending', label: 'Trending' },
              { value: 'popular', label: 'Popular' },
              { value: 'seasonal', label: 'This season' },
              { value: 'top', label: 'Top rated' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </div>
      )}
      {active.error && <ErrorBox message={active.error} />}
      {active.loading && !active.data && (
        <Receiving label={searching ? `searching for “${dq}”` : 'pulling the listings'} />
      )}
      {!active.loading && items.length === 0 && (
        <p className={s.muted}>{searching ? `no anime match “${dq}”.` : 'nothing here yet.'}</p>
      )}
      <Grid items={items} />
    </>
  );
}

const STATUS_LABEL = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Rewatching',
};

async function patchList(patch, toast, onSaved) {
  try {
    await api('/anime/list', { method: 'POST', body: JSON.stringify(patch) });
    toast('List updated', 'success');
    onSaved?.();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/** Status / progress / score editor for a media's AniList list entry. */
function ListControls({ media, scoreFormat, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const entry = media.list_entry;
  const max = SCORE_MAX[scoreFormat] || 10;
  const step = SCORE_STEP[scoreFormat] || 1;
  const prog = entry?.progress || 0;
  const total = media.episodes;

  const save = async (patch) => {
    setBusy(true);
    await patchList({ media_id: media.id, ...patch }, toast, onSaved);
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/anime/list/${entry.id}`, { method: 'DELETE' });
      toast('Removed from list', 'info');
      onSaved?.();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };

  return (
    <div className={s.listPanel}>
      <div className={s.listRow}>
        <span className={s.listLabel}>Status</span>
        <select
          className={s.select}
          disabled={busy}
          value={entry?.status || ''}
          onChange={(e) => save({ status: e.target.value })}
        >
          <option value="" disabled>— add to list —</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      {entry && (
        <>
          <div className={s.listRow}>
            <span className={s.listLabel}>Progress</span>
            <div className={s.stepper}>
              <button disabled={busy || prog <= 0} onClick={() => save({ progress: prog - 1 })}>
                <Minus size={13} />
              </button>
              <span className={s.stepperVal}>{prog}{total ? ` / ${total}` : ''}</span>
              <button disabled={busy || (total && prog >= total)} onClick={() => save({ progress: prog + 1 })}>
                <Plus size={13} />
              </button>
            </div>
          </div>
          <div className={s.listRow}>
            <span className={s.listLabel}>Score</span>
            <input
              className={s.scoreInput}
              type="number"
              min="0"
              max={max}
              step={step}
              defaultValue={entry.score || 0}
              disabled={busy}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v !== (entry.score || 0)) save({ score: v });
              }}
            />
            <span className={s.scoreMax}>/ {max}</span>
          </div>
          <button className={s.removeLink} disabled={busy} onClick={remove}>
            Remove from list
          </button>
        </>
      )}
    </div>
  );
}

function ListEntryCard({ entry, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const m = entry.media;
  const total = m.episodes;
  const prog = entry.progress || 0;
  // Episodes available so far: for an airing show, the episode before the next to
  // air; otherwise the full run. "Behind" = aired-so-far minus what you've watched.
  const aired = m.next_episode ? m.next_episode - 1 : (total || 0);
  const behind = Math.max(0, aired - prog);
  const behindTag = behind > 0 ? `${behind} ep${behind > 1 ? 's' : ''} behind` : null;
  const bump = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    await patchList({ media_id: m.id, progress: prog + 1 }, toast, onSaved);
    setBusy(false);
  };
  return (
    <div className={s.listEntry}>
      <AnimeCard media={m} corner={behindTag} />
      <div className={s.quickRow}>
        <span className={s.quickProg}>{prog}{total ? ` / ${total}` : ''}</span>
        {(!total || prog < total) && (
          <button className={s.quickBtn} disabled={busy} onClick={bump} title="Mark next episode watched">
            <Plus size={12} /> ep
          </button>
        )}
      </div>
    </div>
  );
}

// AniList's natural shelf order; custom lists (no standard status) sort last.
const STATUS_ORDER = ['CURRENT', 'REPEATING', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'];
const groupKey = (g) => g.status || g.name;

function MyListTab() {
  const lists = useApi('/anime/lists');
  const [filter, setFilter] = useState('all');
  if (lists.loading && !lists.data) return <Receiving label="opening your shelves" />;
  if (lists.error) {
    return (
      <EmptyState
        icon={<Clapperboard size={32} />}
        color="var(--c-anime)"
        title="Connect AniList to see your lists"
        subtitle="Add your AniList app credentials in Settings → Connections, then connect. Your watching, planning and completed shelves show up here."
        action={
          <Button onClick={() => (window.location.href = '/settings')}>Open Settings</Button>
        }
      />
    );
  }
  const groups = (lists.data?.lists || [])
    .filter((g) => g.entries.length > 0)
    .sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.status), bi = STATUS_ORDER.indexOf(b.status);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  if (groups.length === 0) return <p className={s.muted}>Your AniList anime list is empty.</p>;

  const shown = filter === 'all' ? groups : groups.filter((g) => groupKey(g) === filter);

  return (
    <>
      <div className={s.filterRow}>
        <button
          className={`${s.filterPill} ${filter === 'all' ? s.filterPillOn : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        {groups.map((g) => {
          const key = groupKey(g);
          return (
            <button
              key={key}
              className={`${s.filterPill} ${filter === key ? s.filterPillOn : ''}`}
              onClick={() => setFilter(key)}
            >
              {STATUS_LABEL[g.status] || g.name}
              <span className={s.filterCount}>{g.entries.length}</span>
            </button>
          );
        })}
      </div>

      <div className={s.lists}>
        {shown.map((g) => (
          <section key={groupKey(g)} className={s.listGroup}>
            <h3 className={s.listHead}>
              {STATUS_LABEL[g.status] || g.name}
              <span className={s.listCount}>{g.entries.length}</span>
            </h3>
            <div className={s.grid}>
              {g.entries.map((e) => (
                <ListEntryCard key={e.entry_id} entry={e} onSaved={lists.reload} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function TrailerChannel() {
  const ch = useApi('/anime/channel');
  const { open, enqueue } = usePlayer();
  const toast = useToast();

  if (ch.loading && !ch.data) return <Receiving label="tuning the anime channel" />;
  if (ch.error) {
    return (
      <EmptyState
        icon={<Clapperboard size={32} />}
        color="var(--c-anime)"
        title="Connect AniList to tune the channel"
        subtitle="The Anime Channel reels through trailers for shows related to what you've watched. Connect AniList in Settings to build it from your list."
        action={<Button onClick={() => (window.location.href = '/settings')}>Open Settings</Button>}
      />
    );
  }
  const reel = (ch.data?.items || []).map((m) => ({ m, item: trailerItem(m) })).filter((x) => x.item);
  if (!reel.length) {
    return <p className={s.muted}>No related trailers yet — watch and rate a few anime, then check back.</p>;
  }

  // Lean-back: play one trailer and queue the rest; the player auto-advances on end.
  const playFrom = (i) => {
    open(reel[i].item);
    reel.slice(i + 1).forEach((t) => enqueue(t.item));
  };
  const plan = async (e, m) => {
    e.preventDefault();
    e.stopPropagation();
    await patchList({ media_id: m.id, status: 'PLANNING' }, toast);
  };

  return (
    <>
      <div className={s.channelHead}>
        <Button onClick={() => playFrom(0)}>
          <Play size={15} fill="currentColor" /> Play the channel
        </Button>
        <span className={s.muted} style={{ padding: 0 }}>
          {reel.length} trailers · related to what you've watched
        </span>
      </div>
      <div className={s.guide}>
        {reel.map((t, i) => (
          <div key={t.m.id} className={s.guideRow}>
            <button className={s.guideThumb} onClick={() => playFrom(i)} title="Play from here">
              <img src={t.m.trailer.thumbnail || t.m.cover} alt="" loading="lazy" />
              <span className={s.guidePlay}><Play size={18} fill="currentColor" /></span>
            </button>
            <div className={s.guideMeta}>
              <Link to={`/anime/${t.m.id}`} className={s.guideTitle}>{t.m.title}</Link>
              <span className={s.guideSub}>{metaLine(t.m)}</span>
              <button className={s.planBtn} onClick={(e) => plan(e, t.m)}>
                <Plus size={11} /> Planning
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DiscussionsTab() {
  const [mode, setMode] = useState('forum');
  return (
    <>
      <div className={s.browseBar}>
        <SegmentedControl
          options={[{ value: 'forum', label: 'Forum' }, { value: 'activity', label: 'Activity' }]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === 'forum' ? <ForumList /> : <ActivityFeed />}
    </>
  );
}

const TABS = [
  { id: 'browse', label: 'Browse & Search' },
  { id: 'list', label: 'My List' },
  { id: 'channel', label: 'The Anime Channel' },
  { id: 'discuss', label: 'Discussions' },
];

export default function Anime() {
  const [tab, setTab] = useState('browse');
  return (
    <>
      <SectionHead
        kicker="No 06 — The Anime"
        title="The picture scroll"
        note="Browse and search AniList, keep your list in sync, and watch — all on this machine."
        color="var(--c-anime)"
      />
      <div className={s.tabs} style={ACCENT}>
        <SegmentedControl
          options={TABS.map((t) => ({ value: t.id, label: t.label }))}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'browse' && <BrowseTab />}
      {tab === 'list' && <MyListTab />}
      {tab === 'channel' && <TrailerChannel />}
      {tab === 'discuss' && <DiscussionsTab />}
    </>
  );
}

// ── Detail page ────────────────────────────────────────────────────────────────

function RelStrip({ title, items }) {
  const ref = useHorizontalWheel();
  if (!items.length) return null;
  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>{title}</h3>
      <div className={s.relRow} ref={ref}>
        {items.map((m) => (
          <div key={m.id} className={s.relItem}>
            <AnimeCard media={m} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RecStrip({ title, sourceId, recs, canPost }) {
  const ref = useHorizontalWheel();
  const toast = useToast();
  const items = recs.filter((r) => r.media);
  if (!items.length) return null;
  const endorse = async (recId) => {
    try {
      await api('/anime/recommend', {
        method: 'POST',
        body: JSON.stringify({ media_id: sourceId, recommend_id: recId }),
      });
      toast('Recommendation sent to AniList', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>{title}</h3>
      <div className={s.relRow} ref={ref}>
        {items.map((r) => (
          <div key={r.media.id} className={s.relItem}>
            <AnimeCard media={r.media} />
            {canPost && (
              <button className={s.endorseBtn} onClick={() => endorse(r.media.id)} title="Agree with this recommendation">
                <ThumbsUp size={12} /> agree
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EpisodeList({ media }) {
  const eps = useApi(`/anime/episodes/${media.id}`);
  const { open } = usePlayer();

  const play = (ep) =>
    open({
      id: `anime:${media.id}:${ep.number}`,
      platform: 'anime',
      title: `${media.title} — Episode ${ep.number}`,
      thumbnail: ep.image || media.cover,
      url: `https://anilist.co/anime/${media.id}`,
      source: media.title,
      published_at: 0,
      extra: { stream_key: ep.key, anilist_id: media.id, episode: ep.number },
    });

  if (eps.loading && !eps.data) return <Receiving label="finding episodes" />;
  if (eps.error) {
    return (
      <p className={s.muted}>
        Can't reach the episode source. Set it up in Settings → Anime, then reload.
      </p>
    );
  }
  const list = eps.data?.episodes || [];
  if (!list.length) return <p className={s.muted}>No episodes found for this title on the source.</p>;

  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>Episodes</h3>
      <div className={s.episodes}>
        {list.map((ep) => (
          <button key={ep.key} className={s.episode} onClick={() => play(ep)}>
            <div className={s.epThumb}>
              {ep.image ? <img src={ep.image} alt="" loading="lazy" /> : <Tv size={18} />}
              <span className={s.epPlay}><Play size={15} fill="currentColor" /></span>
            </div>
            <div className={s.epMeta}>
              <span className={s.epNum}>Episode {ep.number}</span>
              {ep.title && ep.title !== `Episode ${ep.number}` && (
                <span className={s.epTitle}>{ep.title}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnimeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { open } = usePlayer();
  const detail = useApi(`/anime/media/${id}`);
  const me = useApi('/anime/me');
  const m = detail.data;

  const trailer = m && trailerItem(m);

  return (
    <>
      <button onClick={() => navigate(-1)} className={s.back}>
        <ArrowLeft size={13} /> back
      </button>

      {detail.error && <ErrorBox message={detail.error} />}
      {detail.loading && !m && <Receiving label="unrolling the scroll" />}

      {m && (
        <article className={s.detail} style={{ '--cover-c': m.color || 'var(--c-anime)' }}>
          {m.banner && <div className={s.banner} style={{ backgroundImage: `url(${m.banner})` }} />}
          <div className={s.detailHead}>
            {m.cover_xl && <img className={s.poster} src={m.cover_xl} alt="" />}
            <div className={s.detailMeta}>
              <span className="kicker" style={{ color: 'var(--c-anime)' }}>
                {[m.format, m.status, m.season && `${m.season} ${m.year}`].filter(Boolean).join(' · ')}
              </span>
              <h1 className={s.detailTitle}>{m.title}</h1>
              {m.title_native && <div className={s.detailNative}>{m.title_native}</div>}
              <div className={s.detailStats}>
                {scoreLabel(m.score) && <span><Star size={13} fill="currentColor" /> {scoreLabel(m.score)}</span>}
                {m.episodes && <span><Tv size={13} /> {m.episodes} episodes</span>}
                {m.list_entry && (
                  <span className={s.listChip}>
                    {STATUS_LABEL[m.list_entry.status] || 'On your list'}
                    {m.list_entry.progress ? ` · ${m.list_entry.progress}` : ''}
                  </span>
                )}
              </div>
              <div className={s.detailActions}>
                {trailer && (
                  <Button onClick={() => open(trailer)}>
                    <Play size={15} fill="currentColor" /> Play trailer
                  </Button>
                )}
              </div>
              {m.genres?.length > 0 && (
                <div className={s.genreRow}>
                  {m.genres.map((g) => (
                    <span key={g} className={s.genre}>{g}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {me.data && (
            <div className={s.yourList}>
              <h3 className={s.blockLabel}>Your list</h3>
              <ListControls media={m} scoreFormat={me.data.score_format} onSaved={detail.reload} />
            </div>
          )}

          {m.description && (
            <p
              className={s.synopsis}
              dangerouslySetInnerHTML={{ __html: m.description }}
            />
          )}

          <EpisodeList media={m} />

          <RecStrip
            title="Recommended if you like this"
            sourceId={m.id}
            recs={m.recommendations || []}
            canPost={!!me.data}
          />
          <RelStrip
            title="Related"
            items={(m.relations || []).map((r) => r.media).filter(Boolean)}
          />

          <div className={s.relBlock}>
            <h3 className={s.blockLabel}>Discussion</h3>
            <ForumList mediaId={m.id} />
          </div>
        </article>
      )}
    </>
  );
}
