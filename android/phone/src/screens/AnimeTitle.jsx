// One anime, as a phone page.
//
// The top is everything you'd reach for: the poster and title over the banner,
// the next episode's countdown, one big button that plays the right episode
// (resume where you stopped, else the next unwatched — or the official site when
// the local source doesn't have it), and your list entry right under it — shelf,
// a −/＋ progress stepper, your score in your own format, the rest in a sheet.
// The time left to finish what's aired (and when you'd be done if you started
// now) replaces the desktop's hover-and-tap Reckoner.
//
// Below, on tabs: Episodes (spoiler-guarded; long-press one to mark everything up
// to it watched), About (synopsis, tags, rankings, the facts, airing log, staff,
// links), Cast (with the dub switch), Related (watch order, relations,
// recommendations you can vote on), Reviews, and Talk (forum threads, activity).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Calendar, Check, ChevronRight, Clock, ExternalLink, Eye, EyeOff, Flag, Heart, Minus, Play, PlayCircle, Plus, Repeat,
  Pencil, Share2, SlidersHorizontal, Sparkles, ThumbsDown, ThumbsUp, Trash2, Tv,
} from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { ActivityFeed } from '@pc/components/anime/Activity.jsx';
import { openCurtainCall } from '@pc/components/anime/CurtainCallHost.jsx';
import {
  BroadcastLog, CommunityNumbers, CreditsRoll, FranchiseGuide, InfoLedger, LinksShelf, RankRibbons, RELATION_LABEL, ReviewsBlock,
  useExtras,
} from '@pc/components/anime/DetailExtras.jsx';
import { ForumList } from '@pc/components/anime/Forum.jsx';
import {
  airingDateLabel, discoverHref, FavToggle, fmtCountdown, MEDIA_STATUS, personalScore, SCORE_MAX, SCORE_STEP, seasonLabel,
  STATUS_META, SyncBadge, trailerItem, useCountdownTick, useParamState,
} from '@pc/components/anime/shared.jsx';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { compact } from '@pc/lib/format.js';
import { clock } from '@pc/lib/time.js';
import { applyOverlay, COMPLETE_RATIO, useAnimeSync, useProgress, useToast } from '@pc/state.jsx';

import { haptic, openExternal, share } from '../lib/bridge.js';
import { parallax } from '../lib/motion.js';
import { usePlay } from '../lib/play.js';
import { ActionSheet, AppBar, Chips, Empty, ErrorNote, IconBtn, Sheet, Skeleton, useLongPress } from '../shell/Shell.jsx';
import { episodeItem, hm, mergeEpisodes, officialUrl, Poster, ScoreControl, ScoreShown } from './animeKit.jsx';
import t from './animetitle.module.css';

const SPOILER_KEY = 'tubcal.anime.spoilerGuard';
const TABS = [
  { key: 'episodes', label: 'Episodes' },
  { key: 'about', label: 'About' },
  { key: 'cast', label: 'Cast' },
  { key: 'related', label: 'Related' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'talk', label: 'Talk' },
];

function Countdown({ next }) {
  const atMs = next?.airing_at ? next.airing_at * 1000 : 0;
  useCountdownTick(atMs);
  if (!atMs || atMs <= Date.now()) return null;
  return (
    <div className={t.countdown}>
      <span className={t.pulse} />
      <span>Episode {next.episode} in <b>{fmtCountdown(atMs - Date.now())}</b></span>
      <em>{airingDateLabel(next.airing_at)}</em>
    </div>
  );
}

// ── your list entry ──────────────────────────────────────────────────────────

function MoreDetails({ open, onClose, media, entry, viewer, scoreFormat, save, remove }) {
  if (!entry) return null;
  const cats = viewer?.advanced_scoring || [];
  const customLists = viewer?.custom_lists || [];
  const repeat = entry.repeat || 0;
  return (
    <Sheet open={open} onClose={onClose} title="List details" full>
      <div className={t.details}>
        <div className={t.detailRow}>
          <span><Repeat size={15} /> Rewatches</span>
          <div className={t.stepSm}>
            <button type="button" disabled={repeat <= 0} onClick={() => save({ repeat: repeat - 1 })} aria-label="One fewer"><Minus size={16} /></button>
            <b>{repeat}×</b>
            <button type="button" onClick={() => save({ repeat: repeat + 1 })} aria-label="One more"><Plus size={16} /></button>
          </div>
        </div>
        <label className={t.detailRow}>
          <span><Calendar size={15} /> Started</span>
          <input type="date" defaultValue={entry.started_at || ''} onChange={(e) => save({ started_at: e.target.value })} />
        </label>
        <label className={t.detailRow}>
          <span><Calendar size={15} /> Finished</span>
          <input type="date" defaultValue={entry.completed_at || ''} onChange={(e) => save({ completed_at: e.target.value })} />
        </label>
        <label className={t.notes}>
          <span>Notes</span>
          <textarea rows={3} placeholder="A private note for this title…" defaultValue={entry.notes || ''} onBlur={(e) => { if (e.target.value !== (entry.notes || '')) save({ notes: e.target.value }); }} />
        </label>
        {cats.length > 0 && (
          <div className={t.cats}>
            <span className={t.detailHead}>Scored by category</span>
            {cats.map((c) => {
              const v = Number(entry.advanced_scores?.[c] || 0);
              return (
                <label key={c} className={t.catRow}>
                  <span>{c}</span>
                  <input
                    type="range"
                    min="0"
                    max={SCORE_MAX[scoreFormat] || 10}
                    step={SCORE_STEP[scoreFormat] || 1}
                    defaultValue={v}
                    onChange={(e) => save({ advanced_scores: { ...(entry.advanced_scores || {}), [c]: Number(e.target.value) } })}
                  />
                  <b>{v || '—'}</b>
                </label>
              );
            })}
          </div>
        )}
        {customLists.length > 0 && (
          <div className={t.cats}>
            <span className={t.detailHead}>Custom lists</span>
            <div className={t.wrap}>
              {customLists.map((c) => {
                const on = (entry.custom_lists || []).includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={on ? t.chipOn : t.chip}
                    aria-pressed={on}
                    onClick={() => save({ custom_lists: on ? (entry.custom_lists || []).filter((x) => x !== c) : [...(entry.custom_lists || []), c] })}
                  >
                    {on ? <Check size={13} /> : <Plus size={13} />} {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <label className={t.toggle}>
          <input type="checkbox" checked={!!entry.private} onChange={(e) => save({ private: e.target.checked })} />
          <span><b>Private</b> — hidden from your public list and activity</span>
        </label>
        <label className={t.toggle}>
          <input type="checkbox" checked={!!entry.hidden} onChange={(e) => save({ hidden: e.target.checked })} />
          <span><b>Hide from status lists</b> — show only under its custom lists</span>
        </label>
        <button type="button" className={t.remove} onClick={() => { onClose(); remove(); }}><Trash2 size={16} /> Remove {media.title} from your list</button>
      </div>
    </Sheet>
  );
}

/** Scoring, on purpose: the options in a sheet, and nothing reaches AniList
 *  until Save. Point scales get −/＋ for the exact number a slider makes fiddly. */
function ScoreSheet({ open, onClose, scoreFormat, value, onSave }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = SCORE_MAX[scoreFormat] || 10;
  const step = scoreFormat === 'POINT_100' ? 1 : SCORE_STEP[scoreFormat] || 1;
  const points = scoreFormat !== 'POINT_5' && scoreFormat !== 'POINT_3';
  const nudge = (d) => setDraft((v) => Math.min(max, Math.max(0, Math.round((v + d) / step) * step)));
  const changed = draft !== value;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your score"
      footer={
        <div className={t.scoreFoot}>
          <button type="button" className={t.scoreClear} disabled={!value} onClick={() => { haptic('tick'); onSave(0); onClose(); }}>
            Clear
          </button>
          <button type="button" className={t.scoreSave} disabled={!changed} onClick={() => { haptic('done'); onSave(draft); onClose(); }}>
            <Check size={17} /> {changed ? `Save ${draft || 'no score'}` : 'Saved'}
          </button>
        </div>
      }
    >
      <div className={t.scoreSheet}>
        <ScoreControl scoreFormat={scoreFormat} value={draft} onSet={setDraft} />
        {points && (
          <div className={t.scoreNudge}>
            <button type="button" onClick={() => nudge(-step)} disabled={draft <= 0} aria-label="Lower"><Minus size={18} /></button>
            <span>{step === 1 ? '1 point' : `${step} point`} at a time</span>
            <button type="button" onClick={() => nudge(step)} disabled={draft >= max} aria-label="Higher"><Plus size={18} /></button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ListPanel({ media, viewer }) {
  const { overlay, syncState, queueListEdit, removeListEntry } = useAnimeSync();
  const [more, setMore] = useState(false);
  const [scoring, setScoring] = useState(false);
  const entry = applyOverlay(media.id, media.list_entry, overlay);
  const scoreFormat = viewer?.score_format;
  const save = (patch) => queueListEdit(media, patch);
  const prog = entry?.progress || 0;
  const total = media.episodes;

  if (!entry) {
    return (
      <section className={t.panel}>
        <span className={t.panelHead}>Add to your list</span>
        <div className={t.addRow}>
          <button type="button" className={t.addMain} onClick={() => save({ status: 'CURRENT' })}><Eye size={17} /> Watching</button>
          <button type="button" className={t.addAlt} onClick={() => save({ status: 'PLANNING' })}><Plus size={17} /> Plan to watch</button>
        </div>
        <div className={t.statusRow}>
          {STATUS_META.filter(([v]) => !['CURRENT', 'PLANNING'].includes(v)).map(([v, label, Icon]) => (
            <button key={v} type="button" className={t.status} onClick={() => save({ status: v })}><Icon size={14} /> {label}</button>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className={t.panel}>
      <div className={t.panelTop}>
        <span className={t.panelHead}>Your list</span>
        <SyncBadge status={syncState[media.id]} />
        <button type="button" className={t.moreBtn} onClick={() => setMore(true)}><SlidersHorizontal size={15} /> Details</button>
      </div>
      <div className={t.statusRow}>
        {STATUS_META.map(([v, label, Icon]) => (
          <button key={v} type="button" className={entry.status === v ? t.statusOn : t.status} onClick={() => save({ status: v })} aria-pressed={entry.status === v}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      <div className={t.progress}>
        <button type="button" className={t.step} disabled={prog <= 0} onClick={() => { haptic('tick'); save({ progress: prog - 1 }); }} aria-label="One episode fewer"><Minus size={22} /></button>
        <div className={t.progMid}>
          <b><span key={prog} className="ph-tick">{prog}</span><small>{total ? ` / ${total}` : ''}</small></b>
          <span>episodes watched</span>
          <i className={t.progBar}><i style={{ width: `${total ? Math.min(100, (prog / total) * 100) : prog ? 100 : 0}%` }} /></i>
        </div>
        <button type="button" className={`${t.step} ${t.stepPlus}`} disabled={!!total && prog >= total} onClick={() => { haptic('done'); save({ progress: prog + 1 }); }} aria-label="One episode more"><Plus size={22} /></button>
      </div>
      {total > 0 && prog < total && entry.status !== 'COMPLETED' && (
        <button type="button" className={t.finish} onClick={() => save({ status: 'COMPLETED', progress: total })}><Flag size={14} /> Finish — mark all {total} watched</button>
      )}
      {entry.status === 'COMPLETED' && media.status === 'FINISHED' && (
        <button type="button" className={t.finish} onClick={() => openCurtainCall(media.id)}><Sparkles size={14} /> Curtain call — rate it, talk the finale, what's next</button>
      )}
      {/* The score sits behind a button: a slider or stars on the page itself
          would change it under a thumb that only meant to scroll past. */}
      <div className={t.score}>
        <span className={t.panelHead}>Your score</span>
        <div className={t.scoreRow}>
          <ScoreShown scoreFormat={scoreFormat} value={entry.score || 0} />
          <button type="button" className={t.scoreEdit} onClick={() => setScoring(true)}>
            <Pencil size={15} /> {entry.score ? 'Edit score' : 'Rate it'}
          </button>
        </div>
      </div>
      <ScoreSheet
        open={scoring}
        onClose={() => setScoring(false)}
        scoreFormat={scoreFormat}
        value={entry.score || 0}
        onSave={(v) => { if (v !== (entry.score || 0)) save({ score: v }); }}
      />
      <MoreDetails open={more} onClose={() => setMore(false)} media={media} entry={entry} viewer={viewer} scoreFormat={scoreFormat} save={save} remove={() => removeListEntry(media, entry.id)} />
    </section>
  );
}

// ── episodes ─────────────────────────────────────────────────────────────────

function useEpisodes(media) {
  const local = useApi(`/anime/episodes/${media.id}`);
  const list = useMemo(() => mergeEpisodes(media, local.data?.episodes), [media, local.data]);
  return { list, loading: local.loading, error: local.error };
}

/** The episode to play next: resume the last one left unfinished, else the next
 *  after the highest touched, else the one after your AniList progress. */
function nextUp(list, media, entry, progress) {
  const key = (n) => `anime:${media.id}:${n}`;
  const ratio = (n) => { const p = progress[key(n)]; return p?.duration ? p.position / p.duration : 0; };
  const touched = list.filter((e) => ratio(e.number) > 0);
  if (touched.length) {
    const last = Math.max(...touched.map((e) => e.number));
    if (ratio(last) < COMPLETE_RATIO) return { ep: list.find((e) => e.number === last), mode: 'resume', pos: progress[key(last)]?.position };
    const after = list.find((e) => e.number > last);
    if (after) return { ep: after, mode: 'next' };
  }
  const n = (entry?.progress || 0) + 1;
  const ep = list.find((e) => e.number === n);
  return ep ? { ep, mode: n === 1 ? 'start' : 'next' } : null;
}

function EpisodeRow({ e, media, veiled, prog, onPlay, onMenu, seriesLink }) {
  const lp = useLongPress(() => onMenu(e));
  const p = prog;
  const r = p?.duration ? Math.min(1, p.position / p.duration) : 0;
  const done = r >= COMPLETE_RATIO;
  const official = officialUrl(e.url || seriesLink);
  return (
    <div className={t.ep} data-reveal>
      <button type="button" className={t.epHit} onClick={(ev) => onPlay(e, ev.currentTarget)} disabled={!e.key && !official} {...lp}>
        <span className={t.epPic}>
          {e.image || media.cover ? <img src={e.image || media.cover} alt="" loading="lazy" className={veiled ? t.veiled : undefined} /> : <Tv size={18} />}
          <span className={t.epPlay}>{e.key ? <Play size={14} fill="currentColor" /> : <ExternalLink size={14} />}</span>
          {r > 0 && <span className={t.epBar}><i className={done ? t.epDone : ''} style={{ width: `${done ? 100 : Math.max(4, r * 100)}%` }} /></span>}
        </span>
        <span className={t.epText}>
          <b>Episode {e.number}</b>
          {e.title && <span className={veiled ? t.veiledText : ''}>{veiled ? 'title hidden until you get here' : e.title}</span>}
          {r > 0 && p?.duration ? <em>{done ? `watched · ${clock(p.duration)}` : `${clock(p.position)} of ${clock(p.duration)}`}</em> : !e.key && official ? <em>on {e.site || 'the official site'}</em> : null}
        </span>
      </button>
    </div>
  );
}

function Episodes({ media, eps, entry }) {
  const { play: playIt } = usePlay();
  const open = (item, from) => playIt(item, from);
  const { progress } = useProgress();
  const { queueListEdit } = useAnimeSync();
  const [guard, setGuard] = useState(() => { try { return localStorage.getItem(SPOILER_KEY) !== '0'; } catch { return true; } });
  const [menu, setMenu] = useState(null);
  const [all, setAll] = useState(false);
  const toggleGuard = () => setGuard((g) => { try { localStorage.setItem(SPOILER_KEY, g ? '0' : '1'); } catch { /* fine */ } return !g; });
  const seenUpTo = entry?.progress || 0;
  const links = media.external_links || [];
  const seriesLink = links[0]?.url || null;
  const list = eps.list;

  const launch = (url, n) => {
    openExternal(officialUrl(url));
    if (n != null && entry && n > (entry.progress || 0)) queueListEdit(media, { progress: n });
  };
  const play = (e, from) => (e.key ? open(episodeItem(media, e), from) : (e.url || seriesLink) && launch(e.url || seriesLink, e.number));
  // a long list opens around where you are, not at episode 1
  const start = !all && list.length > 60 ? Math.max(0, list.findIndex((e) => e.number >= seenUpTo) - 5) : 0;
  const shown = all ? list : list.slice(start, start + 60);

  return (
    <div className={t.tabBody}>
      <div className={t.epTools}>
        {entry && (
          <button type="button" className={guard ? t.chipOn : t.chip} onClick={toggleGuard} aria-pressed={guard}>
            {guard ? <EyeOff size={14} /> : <Eye size={14} />} Spoiler guard
          </button>
        )}
        {links.map((l) => (
          <button key={l.url} type="button" className={t.chip} style={l.color ? { '--ext': l.color } : undefined} onClick={() => launch(l.url, null)}>
            {l.icon && <img src={l.icon} alt="" />} {l.site} <ExternalLink size={12} />
          </button>
        ))}
      </div>
      {!list.length && eps.loading && <Skeleton kind="rows" n={4} />}
      {!list.length && !eps.loading && <Empty Icon={Tv} title="No episodes yet" text="There's no episode listing for this title yet." />}
      {start > 0 && <button type="button" className={t.showAll} onClick={() => setAll(true)}>Show episodes 1–{list[start - 1].number}</button>}
      {shown.map((e) => (
        <EpisodeRow key={e.number} e={e} media={media} veiled={guard && !!entry && e.number > seenUpTo} prog={progress[`anime:${media.id}:${e.number}`]} onPlay={play} onMenu={setMenu} seriesLink={seriesLink} />
      ))}
      {!all && start + 60 < list.length && <button type="button" className={t.showAll} onClick={() => setAll(true)}>Show all {list.length} episodes</button>}
      <ActionSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu ? `Episode ${menu.number}` : ''}
        actions={menu ? [
          menu.key && { label: 'Play here', Icon: Play, onClick: () => open(episodeItem(media, menu)) },
          (menu.url || seriesLink) && { label: `Watch on ${menu.site || links[0]?.site || 'the official site'}`, Icon: ExternalLink, onClick: () => launch(menu.url || seriesLink, null) },
          entry && menu.number > seenUpTo && { label: `Mark 1–${menu.number} watched`, Icon: Check, onClick: () => queueListEdit(media, { progress: menu.number }) },
          entry && menu.number <= seenUpTo && { label: `Unwatch from episode ${menu.number}`, Icon: Minus, onClick: () => queueListEdit(media, { progress: menu.number - 1 }) },
        ] : []}
      />
    </div>
  );
}

// ── cast ─────────────────────────────────────────────────────────────────────

const ROLE = { MAIN: 'Main', SUPPORTING: 'Supporting', BACKGROUND: 'Background' };
function Cast({ characters }) {
  const langs = useMemo(() => {
    const n = {};
    for (const c of characters) for (const v of c.voices) if (v.language) n[v.language] = (n[v.language] || 0) + 1;
    return Object.keys(n).sort((x, y) => (x === 'Japanese' ? -1 : y === 'Japanese' ? 1 : n[y] - n[x]));
  }, [characters]);
  const [lang, setLang] = useState(() => (langs.includes('Japanese') ? 'Japanese' : langs[0]));
  if (!characters.length) return <Empty Icon={Tv} title="No cast listed" />;
  return (
    <div className={t.tabBody}>
      {langs.length > 1 && <Chips items={langs.map((l) => ({ key: l, label: l === 'Japanese' ? '日本語' : l }))} value={lang} onChange={setLang} className={t.tabChips} />}
      {characters.map((c) => {
        const voices = c.voices.filter((v) => v.language === lang);
        const lead = voices[0];
        return (
          <div key={c.id} className={t.castRow} data-reveal>
            <Link to={`/anime/character/${c.id}`} className={t.castSide}>
              <Avatar src={c.image} name={c.name} imgClass={t.castFace} letterClass={t.castLetter} />
              <span><b>{c.name}</b><em>{ROLE[c.role] || c.role}{c.favourites > 0 ? ` · ♥ ${compact(c.favourites)}` : ''}</em></span>
            </Link>
            {lead ? (
              <Link to={`/anime/voice/${lead.id}`} className={`${t.castSide} ${t.castVoice}`}>
                <span><b>{lead.name}</b><em>{voices.length > 1 ? `+${voices.length - 1} more` : lead.dub_group || lang}</em></span>
                <Avatar src={lead.image} name={lead.name} imgClass={t.castFace} letterClass={t.castLetter} />
              </Link>
            ) : <span className={t.uncredited}>not credited</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── related ──────────────────────────────────────────────────────────────────

function RecCell({ sourceId, rec, canVote, scoreFormat }) {
  const toast = useToast();
  const [vote, setVote] = useState(rec.user_rating || 'NO_RATING');
  const [rating, setRating] = useState(rec.rating || 0);
  const cast = async (want) => {
    const next = vote === want ? 'NO_RATING' : want;
    try {
      const res = await api('/anime/recommend', { method: 'POST', body: JSON.stringify({ media_id: sourceId, recommend_id: rec.media.id, rating: next }) });
      setVote(res.user_rating || next);
      setRating(res.rating);
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className={t.recCell} data-reveal="pop">
      <Poster media={rec.media} scoreFormat={scoreFormat} />
      <div className={t.recVote}>
        <span>{rating > 0 ? `+${rating}` : rating}</span>
        {canVote && (
          <>
            <button type="button" className={vote === 'RATE_UP' ? t.voteOn : ''} onClick={() => cast('RATE_UP')} aria-label="Good pairing"><ThumbsUp size={14} /></button>
            <button type="button" className={vote === 'RATE_DOWN' ? t.voteOn : ''} onClick={() => cast('RATE_DOWN')} aria-label="Doesn't fit"><ThumbsDown size={14} /></button>
          </>
        )}
      </div>
    </div>
  );
}

function Related({ media, connected, scoreFormat }) {
  const rel = (media.relations || []).filter((r) => r.media && r.media.type !== 'MANGA');
  const recs = (media.recommendations || []).filter((r) => r.media);
  return (
    <div className={t.tabBody}>
      <div className="ph-reuse ph-tight"><FranchiseGuide mediaId={media.id} /></div>
      {rel.length > 0 && (
        <>
          <h3 className={t.blockHead}>Related</h3>
          <div className={t.grid}>{rel.map((r) => <Poster key={r.media.id} media={r.media} scoreFormat={scoreFormat} corner={RELATION_LABEL[r.relation] || null} />)}</div>
        </>
      )}
      {recs.length > 0 && (
        <>
          <h3 className={t.blockHead}>If you like this</h3>
          <div className={t.grid}>{recs.map((r) => <RecCell key={r.media.id} sourceId={media.id} rec={r} canVote={connected} scoreFormat={scoreFormat} />)}</div>
        </>
      )}
      {!rel.length && !recs.length && <Empty Icon={Tv} title="Nothing related yet" />}
    </div>
  );
}

// ── about ────────────────────────────────────────────────────────────────────

function About({ m, ext }) {
  const [open, setOpen] = useState(false);
  const long = (m.description || '').replace(/<[^>]+>/g, '').length > 360;
  const tags = (m.tags || []).filter((x) => (x.rank || 0) >= 60).slice(0, 16);
  return (
    <div className={t.tabBody}>
      {m.description && (
        <>
          <div className={`${t.synopsis} ${long && !open ? t.clamp : ''}`} dangerouslySetInnerHTML={{ __html: m.description }} />
          {long && <button type="button" className={t.readMore} onClick={() => setOpen((v) => !v)}>{open ? 'Show less' : 'Read more'}</button>}
        </>
      )}
      {tags.length > 0 && (
        <div className={t.wrap}>
          {tags.map((x) => <Link key={x.name} to={discoverHref('t', x.name)} className={t.tag} data-reveal="pop">{x.name}{x.rank != null && <small>{x.rank}%</small>}</Link>)}
        </div>
      )}
      <div className="ph-reuse ph-tight ph-extras">
        <RankRibbons rankings={ext?.rankings} />
        <InfoLedger m={m} ext={ext} />
        <BroadcastLog schedule={ext?.schedule} total={m.episodes} />
        <CommunityNumbers ext={ext} />
        <CreditsRoll staff={ext?.staff} />
        <LinksShelf links={ext?.links} />
      </div>
    </div>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export default function AnimeTitle() {
  const { id } = useParams();
  const detail = useApi(`/anime/media/${id}`);
  const extras = useExtras(id);
  const me = useApi('/anime/me');
  const { play: playIt } = usePlay();
  const { progress } = useProgress();
  const { overlay } = useAnimeSync();
  const art = useRef(null);
  const playBtn = useRef(null);
  const [tab, setTab] = useParamState('t', 'episodes');
  const [talk, setTalk] = useState('threads');
  const m = detail.data;
  const ext = extras.data;
  const connected = !!me.data;
  const scoreFormat = me.data?.score_format;
  const eps = useEpisodes(m || { id });
  const entry = m ? applyOverlay(m.id, m.list_entry, overlay) : null;
  // the banner drifts behind the page as you scroll (slower than the page)
  useEffect(() => parallax(art.current, 0.42, 320), [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.error) return <><AppBar title="Anime" back backTo="/anime" /><ErrorNote message={detail.error} onRetry={detail.reload} /></>;
  if (!m) return <><AppBar title="" back backTo="/anime" /><div className={t.heroSkel}><Skeleton kind="posters" n={3} /></div><Skeleton kind="lines" n={3} /></>;

  const trailer = trailerItem(m);
  const up = nextUp(eps.list, m, entry, progress);
  const links = m.external_links || [];
  const mine = personalScore({ ...m, list_entry: entry }, scoreFormat);
  // the Reckoner: what's aired and unwatched, in time
  const aired = m.next_airing?.episode ? m.next_airing.episode - 1 : (m.episodes || 0);
  const left = Math.max(0, aired - (entry?.progress || 0));
  const per = m.duration || 24;
  const playUp = () => {
    if (eps.loading && !up?.ep.key) return; // the local source is still answering
    if (up?.ep.key) playIt(episodeItem(m, up.ep), playBtn.current);
    else if (up?.ep.url || links[0]?.url) openExternal(officialUrl(up?.ep.url || links[0].url));
  };
  const primaryLabel = !up ? null : up.mode === 'resume' ? `Continue episode ${up.ep.number}` : up.mode === 'start' ? 'Start episode 1' : `Play episode ${up.ep.number}`;

  return (
    <div className={t.page} style={{ '--cover-c': m.color || 'var(--c-anime)' }}>
      <AppBar
        title={m.title}
        back
        backTo="/anime"
        tone="var(--cover-c)"
        className={t.bar}
        actions={
          <>
            {connected && <span className={t.fav}><FavToggle kind="anime" id={m.id} initial={m.is_favourite} count={m.favourites} compact /></span>}
            <IconBtn label="Share" onClick={() => share({ title: m.title, url: `https://anilist.co/anime/${m.id}` })}><Share2 size={20} /></IconBtn>
          </>
        }
      />

      <header className={t.hero}>
        <div className={t.heroArt} ref={art} style={{ backgroundImage: `url(${m.banner || m.cover_xl || m.cover})` }} />
        <div className={t.heroInner}>
          {m.cover_xl || m.cover ? <img className={t.poster} src={m.cover_xl || m.cover} alt="" /> : <span className={t.poster}><Tv size={30} /></span>}
          <div className={t.heroText}>
            <span className={t.eyebrow}>{[m.format, MEDIA_STATUS[m.status] || m.status, seasonLabel(m.season, m.year)].filter(Boolean).join(' · ')}</span>
            <h1 className={t.title}>{m.title}</h1>
            {m.title_native && <span className={t.native}>{m.title_native}</span>}
            <div className={t.scores}>
              {m.score > 0 && <span className={t.avg}>★ {m.score}%</span>}
              {mine && <span className={t.mine}>you {mine}</span>}
              {m.favourites > 0 && <span className={t.favs}><Heart size={11} /> {compact(m.favourites)}</span>}
              {m.studio_refs?.[0] && <Link to={`/anime/studio/${m.studio_refs[0].id}`} className={t.studio}>{m.studio_refs[0].name} <ChevronRight size={12} /></Link>}
            </div>
          </div>
        </div>
        {m.genres?.length > 0 && (
          <div className={t.genres}>{m.genres.map((g, i) => <Link key={g} to={discoverHref('g', g)} style={{ '--gi': i }}>{g}</Link>)}</div>
        )}
      </header>

      <Countdown next={m.next_airing} />

      <div className={t.actions}>
        {primaryLabel && (
          <button type="button" className={t.playMain} onClick={playUp} ref={playBtn}>
            {up.ep.key || eps.loading ? <PlayCircle size={20} /> : <ExternalLink size={18} />}
            <span>
              <b>{primaryLabel}</b>
              <em>
                {up.mode === 'resume' && up.pos ? `from ${clock(up.pos)}`
                  : up.ep.key ? (up.ep.title || 'from the local source')
                    : eps.loading ? 'finding a source…'
                      : `on ${up.ep.site || links[0]?.site || 'the official site'}`}
              </em>
            </span>
          </button>
        )}
        {trailer && <button type="button" className={t.trailer} onClick={(ev) => playIt(trailer, ev.currentTarget)}><Play size={16} fill="currentColor" /> Trailer</button>}
      </div>

      {connected && <ListPanel media={m} viewer={me.data} />}

      {left > 0 && (
        <div className={t.reckoner} data-reveal="fade">
          <Clock size={18} />
          <span>
            <b>{hm(left * per)}</b> to catch up on {left} episode{left === 1 ? '' : 's'}{m.duration ? '' : ' (est.)'}
            <em>start now, done by {new Date(Date.now() + left * per * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</em>
          </span>
        </div>
      )}

      <div className={t.tabs}>
        <Chips items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'episodes' && <Episodes media={m} eps={eps} entry={entry} />}
      {tab === 'about' && <About m={m} ext={ext} />}
      {tab === 'cast' && <Cast characters={m.characters || []} />}
      {tab === 'related' && <Related media={m} connected={connected} scoreFormat={scoreFormat} />}
      {tab === 'reviews' && <div className={`${t.tabBody} ph-reuse ph-tight`}><ReviewsBlock media={m} ext={ext} connected={connected} onChanged={extras.reload} /></div>}
      {tab === 'talk' && (
        <div className={t.tabBody}>
          <Chips items={[{ key: 'threads', label: 'Forum threads' }, { key: 'activity', label: 'Recent activity' }]} value={talk} onChange={setTalk} className={t.tabChips} />
          <div className="ph-reuse ph-tight">{talk === 'threads' ? <ForumList mediaId={m.id} /> : <ActivityFeed mediaId={m.id} />}</div>
        </div>
      )}
      {!connected && me.error && (
        <p className={t.connect}>Connect AniList in Settings to track this, rate it and join the discussion. <Link to="/settings">Settings</Link></p>
      )}
    </div>
  );
}
