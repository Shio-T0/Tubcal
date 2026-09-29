// Everything below the dossier on a title's page that AniList knows and the
// header doesn't show: rankings, the full record, the community's numbers,
// the production credits, the broadcast log, every link, reviews, and a
// watch-order guide to the whole franchise.
//
// They come from one separate request (/extras) so the header paints first,
// and the franchise walk waits until you scroll near it — it's the one part
// that can cost several AniList requests the first time a franchise is seen.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Award, CalendarClock, Check, ExternalLink, Flame, Globe, Hash, Heart, Link2, PenLine, Plus, Radio,
  Star, Tv,
} from 'lucide-react';

import { useApi } from '../../api/client.js';
import { Receiving } from '../layout/Section.jsx';
import { applyOverlay, useAnimeSync, useToast } from '../../state.jsx';
import { compact } from '../../lib/format.js';
import { BarList, ChartTable, Columns, LineChart } from './charts.jsx';
import { ReviewCard, ReviewComposer, ReviewModal } from './Reviews.jsx';
import {
  COUNTRY_LABEL, InfiniteSentinel, MEDIA_STATUS, SOURCE_LABEL, STATUS_LABEL, airingDateLabel, fmtCountdown,
  formatLabel, fuzzyDateLabel, seasonLabel, titleCase, useCountdownTick, useInView, useInfinite,
} from './shared.jsx';
import x from './detailextras.module.css';

export const RELATION_LABEL = {
  PREQUEL: 'Prequel', SEQUEL: 'Sequel', PARENT: 'Parent story', SIDE_STORY: 'Side story',
  SPIN_OFF: 'Spin-off', ALTERNATIVE: 'Alternative', SUMMARY: 'Summary', COMPILATION: 'Compilation',
  CONTAINS: 'Contains', CHARACTER: 'Shares characters', OTHER: 'Other', ADAPTATION: 'Adaptation',
  SOURCE: 'Source',
};

export function useExtras(id) {
  return useApi(`/anime/media/${id}/extras`);
}

function Block({ title, icon: Icon, children, note, className }) {
  return (
    <section className={`${x.block} ${className || ''}`}>
      <h3 className={x.label}>{Icon && <Icon size={12} />} {title}</h3>
      {note && <p className={x.note}>{note}</p>}
      {children}
    </section>
  );
}

// ── rankings ──────────────────────────────────────────────────────────────────

export function RankRibbons({ rankings }) {
  if (!rankings?.length) return null;
  // All-time first, then the narrowest (season) — the ones that read best.
  const sorted = [...rankings].sort((a, b) => (b.all_time - a.all_time) || (a.rank - b.rank)).slice(0, 5);
  return (
    <div className={x.ribbons}>
      {sorted.map((r) => {
        const Icon = r.type === 'RATED' ? Star : Heart;
        const when = r.all_time ? '' : [r.season && titleCase(r.season), r.year].filter(Boolean).join(' ');
        const ctx = r.context.replace(/ all time$/, '');
        return (
          <span key={`${r.type}-${r.context}-${r.year}-${r.season}`} className={r.rank <= 10 ? x.ribbonGold : x.ribbon}>
            <Icon size={12} fill="currentColor" />
            <b>#{r.rank}</b> {ctx.charAt(0).toUpperCase() + ctx.slice(1)}
            {r.all_time ? ' all time' : when ? ` · ${when}` : ''}
          </span>
        );
      })}
    </div>
  );
}

// ── the full record ───────────────────────────────────────────────────────────

function Row({ label, children }) {
  if (children == null || children === '' || (Array.isArray(children) && !children.length)) return null;
  return (
    <div className={x.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function InfoLedger({ m, ext }) {
  const main = (ext?.studios || []).filter((s) => s.main);
  const producers = (ext?.studios || []).filter((s) => !s.main);
  const aired = ext
    ? [fuzzyDateLabel(ext.start), ext.end ? fuzzyDateLabel(ext.end) : m.status === 'RELEASING' ? 'now' : null]
      .filter(Boolean).join(' – ')
    : null;
  const studioLinks = (list) => list.map((s, i) => (
    <span key={s.id}>{i > 0 && ', '}<Link to={`/anime/studio/${s.id}`}>{s.name}</Link></span>
  ));
  return (
    <Block title="The record" icon={Tv} className={x.record}>
      <dl className={x.ledger}>
        <Row label="Romaji">{m.title_romaji}</Row>
        <Row label="Native"><span lang="ja">{m.title_native}</span></Row>
        <Row label="Also known as">{ext?.synonyms?.length ? ext.synonyms.join(' · ') : null}</Row>
        <Row label="Format">{formatLabel(m.format)}</Row>
        <Row label="Episodes">{m.episodes ? `${m.episodes}${m.duration ? ` × ${m.duration} min` : ''}` : m.duration ? `${m.duration} min` : null}</Row>
        <Row label="Status">{MEDIA_STATUS[m.status] || m.status}</Row>
        <Row label="Aired">{aired}</Row>
        <Row label="Season">{seasonLabel(m.season, m.year)}</Row>
        <Row label="Source">{SOURCE_LABEL[ext?.source || m.source]}</Row>
        <Row label="Origin">{COUNTRY_LABEL[ext?.country || m.country] || ext?.country}</Row>
        <Row label={main.length > 1 ? 'Studios' : 'Studio'}>{main.length ? studioLinks(main) : null}</Row>
        <Row label="Producers">{producers.length ? studioLinks(producers) : null}</Row>
        <Row label="Average · mean">{m.score || ext?.mean_score ? `${m.score ?? '—'}% · ${ext?.mean_score ?? '—'}%` : null}</Row>
        <Row label="Popularity">{m.popularity ? `${m.popularity.toLocaleString()} lists` : null}</Row>
        <Row label="Favourites">{ext?.favourites ? ext.favourites.toLocaleString() : null}</Row>
        <Row label="Trending">{ext?.trending ? `${ext.trending} this week` : null}</Row>
        <Row label="Hashtag">{ext?.hashtag ? <span className={x.hash}><Hash size={11} />{ext.hashtag.replace(/#/g, ' ').trim()}</span> : null}</Row>
        <Row label="Licensed">{ext?.licensed == null ? null : ext.licensed ? 'Yes' : 'No'}</Row>
        <Row label="Elsewhere">
          <span className={x.elsewhere}>
            {ext?.site_url && <a href={ext.site_url} target="_blank" rel="noreferrer">AniList <ExternalLink size={10} /></a>}
            {m.id_mal && <a href={`https://myanimelist.net/anime/${m.id_mal}`} target="_blank" rel="noreferrer">MyAnimeList <ExternalLink size={10} /></a>}
          </span>
        </Row>
      </dl>
    </Block>
  );
}

// ── the community's numbers ───────────────────────────────────────────────────

const dateLabel = (sec) => new Date(sec * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });

export function CommunityNumbers({ ext }) {
  if (!ext) return null;
  const scores = ext.score_dist || [];
  const statuses = ext.status_dist || [];
  const watching = (ext.trends || []).filter((t) => t.watching != null).map((t) => ({ x: t.date, y: t.watching }));
  const avg = (ext.trends || []).filter((t) => t.score != null).map((t) => ({ x: t.date, y: t.score }));
  const totalListed = statuses.reduce((n, s) => n + s.amount, 0);
  if (!scores.length && !statuses.length && watching.length < 5) return null;
  return (
    <Block title="By the numbers" icon={Flame} note="How AniList's users have scored and shelved it.">
      <div className={x.numbers}>
        {scores.length > 0 && (
          <div>
            <span className={x.sub}>Scores given</span>
            <Columns
              data={scores.map((s) => ({ key: s.score, label: String(s.score), value: s.amount }))}
              height={110}
              format={compact}
              tip={(d) => `${d.value.toLocaleString()} users scored it ${d.key}`}
              ariaLabel="Score distribution"
            />
            <ChartTable columns={[{ key: 'score', label: 'score' }, { key: 'amount', label: 'users' }]} rows={scores} />
          </div>
        )}
        {statuses.length > 0 && (
          <div>
            <span className={x.sub}>On users' lists · {compact(totalListed)}</span>
            <BarList
              rows={statuses.map((s) => ({ key: s.status, label: STATUS_LABEL[s.status] || s.status, value: s.amount }))}
              format={compact}
              tip={(r) => `${r.value.toLocaleString()} · ${totalListed ? Math.round((100 * r.value) / totalListed) : 0}% of lists`}
            />
          </div>
        )}
      </div>
      {(watching.length >= 5 || avg.length >= 5) && (
        <div className={x.trends}>
          {watching.length >= 5 && <LineChart title="Watching right now" points={watching} format={compact} xFormat={dateLabel} />}
          {avg.length >= 5 && <LineChart title="Average score" points={avg} format={(v) => `${v}%`} xFormat={dateLabel} />}
        </div>
      )}
    </Block>
  );
}

// ── production credits ────────────────────────────────────────────────────────

export function CreditsRoll({ staff }) {
  const [all, setAll] = useState(false);
  if (!staff?.length) return null;
  const people = [];
  const byId = {};
  for (const s of staff) {
    if (!byId[s.id]) people.push((byId[s.id] = { ...s, roles: [] }));
    byId[s.id].roles.push(s.role);
  }
  const shown = all ? people : people.slice(0, 10);
  return (
    <Block title="Credits" icon={Award} className={x.credits}>
      <ol className={x.roll}>
        {shown.map((p, i) => (
          <li key={p.id} style={{ '--i': Math.min(i, 12) }}>
            <span className={x.role}>{p.roles.join(' · ')}</span>
            <Link to={`/anime/voice/${p.id}`} className={x.who}>
              {p.name}
              {p.native && <em lang="ja">{p.native}</em>}
            </Link>
          </li>
        ))}
      </ol>
      {people.length > 10 && (
        <button type="button" className={x.rollMore} onClick={() => setAll((v) => !v)}>
          {all ? 'fewer credits' : `roll the remaining ${people.length - 10}`}
        </button>
      )}
    </Block>
  );
}

// ── broadcast log ─────────────────────────────────────────────────────────────

function LogRow({ ep, total }) {
  const at = ep.airing_at * 1000;
  useCountdownTick(at);
  const left = at - Date.now();
  return (
    <li className={x.logRow}>
      <span className={x.logEp}>Ep {ep.episode}{total ? <i>/{total}</i> : null}</span>
      <span className={x.logDate}>{airingDateLabel(ep.airing_at)}</span>
      <span className={x.logIn}>{left > 0 ? `in ${fmtCountdown(left)}` : 'aired'}</span>
    </li>
  );
}

export function BroadcastLog({ schedule, total }) {
  if (!schedule?.length) return null;
  return (
    <Block title="Broadcast log" icon={CalendarClock} note="Upcoming episodes, in your local time.">
      <ol className={x.log}>
        {schedule.map((ep) => <LogRow key={ep.episode} ep={ep} total={total} />)}
      </ol>
    </Block>
  );
}

// ── links ─────────────────────────────────────────────────────────────────────

const LINK_GROUPS = [
  ['STREAMING', 'Watch', Radio],
  ['INFO', 'Official', Globe],
  ['SOCIAL', 'Social', Link2],
];

export function LinksShelf({ links }) {
  if (!links?.length) return null;
  return (
    <Block title="Links" icon={Link2}>
      <div className={x.linkGroups}>
        {LINK_GROUPS.map(([type, label, Icon]) => {
          const list = links.filter((l) => (l.type || 'INFO') === type);
          if (!list.length) return null;
          return (
            <div key={type} className={x.linkGroup}>
              <span className={x.sub}><Icon size={11} /> {label}</span>
              <div className={x.linkChips}>
                {list.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className={x.linkChip}
                     style={l.color ? { '--l-c': l.color } : undefined} title={l.notes || undefined}>
                    {l.icon ? <img src={l.icon} alt="" /> : <ExternalLink size={12} />}
                    {l.site}
                    {l.language && <em>{l.language}</em>}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Block>
  );
}

// ── reviews ───────────────────────────────────────────────────────────────────

export function ReviewsBlock({ media, ext, connected, onChanged }) {
  const [open, setOpen] = useState(null);
  const [writing, setWriting] = useState(false);
  const [more, setMore] = useState(false);
  const feed = useInfinite(`mr|${media.id}`, (p) => `/anime/reviews?media_id=${media.id}&sort=top&page=${p}`, { enabled: more });
  const first = ext?.reviews || [];
  const rows = more ? (feed.items || first) : first;
  if (!first.length && !connected) return null;
  return (
    <Block title="Reviews" icon={PenLine}>
      <div className={x.reviewBar}>
        <span className={x.note}>{first.length ? 'The most helpful, as voted on AniList.' : 'Nobody has reviewed this yet.'}</span>
        {connected && (
          <button type="button" className={x.write} onClick={() => setWriting(true)}><PenLine size={13} /> Write a review</button>
        )}
      </div>
      {rows.length > 0 && (
        <div className={x.reviewGrid}>
          {rows.map((r, i) => (
            <ReviewCard key={r.id} review={{ ...r, media: { color: media.color } }} showMedia={false} index={i} onOpen={() => setOpen(r.id)} />
          ))}
        </div>
      )}
      {more && feed.items?.length > 0 && (
        <InfiniteSentinel onReach={feed.loadMore} active={feed.hasMore && !feed.error} count={feed.items.length} />
      )}
      {first.length >= 6 && !more && (
        <button type="button" className={x.rollMore} onClick={() => setMore(true)}>all reviews</button>
      )}
      {open && <ReviewModal id={open} onClose={() => setOpen(null)} />}
      {writing && <ReviewComposer media={media} onClose={() => setWriting(false)} onSaved={onChanged} />}
    </Block>
  );
}

// ── the watch-order guide ─────────────────────────────────────────────────────

const KIND_LABEL = {
  main: 'Main story', side: 'Side story', 'spin-off': 'Spin-off', alternative: 'Alternative version',
  recap: 'Recap — skippable', extra: 'Extra',
};

function GuideItem({ it, step }) {
  const { overlay, queueListEdit } = useAnimeSync();
  const toast = useToast();
  const entry = applyOverlay(it.id, it.list, overlay);
  const done = entry && ['COMPLETED'].includes(entry.status);
  const year = it.start?.[0] || it.year;
  return (
    <li className={`${x.gItem} ${it.kind === 'main' ? x.gMain : x.gSide} ${it.is_root ? x.gRoot : ''} ${done ? x.gDone : ''}`}
        style={{ '--cover-c': it.color || 'var(--c-anime)' }}>
      <span className={x.gYear}>{year || '—'}</span>
      <span className={x.gNode} aria-hidden="true">{it.kind === 'main' ? (done ? <Check size={11} /> : step) : ''}</span>
      <div className={x.gCard}>
        <Link to={`/anime/${it.id}`} className={x.gCover}>{it.cover ? <img src={it.cover} alt="" loading="lazy" /> : <Tv size={14} />}</Link>
        <div className={x.gInfo}>
          <Link to={`/anime/${it.id}`} className={x.gTitle}>{it.title}</Link>
          <span className={x.gMeta}>
            <b className={x[`k_${it.kind.replace('-', '')}`]}>{KIND_LABEL[it.kind]}</b>
            {[formatLabel(it.format), it.episodes && `${it.episodes} ep`,
              it.status === 'RELEASING' ? 'airing' : it.status === 'NOT_YET_RELEASED' ? 'upcoming' : null].filter(Boolean).join(' · ')}
            {it.relation && !it.is_root && <i> · {RELATION_LABEL[it.relation]?.toLowerCase()} of this</i>}
          </span>
        </div>
        <span className={x.gAside}>
          {it.is_root && <span className={x.here}>you are here</span>}
          {entry?.status ? (
            <span className={x.gStatus}>{STATUS_LABEL[entry.status]}{entry.status === 'CURRENT' && entry.progress ? ` ${entry.progress}` : ''}</span>
          ) : !it.is_root && (
            <button type="button" className={x.gPlan} onClick={() => { queueListEdit(it, { status: 'PLANNING' }); toast(`“${it.title}” → Planning`, 'success'); }}>
              <Plus size={11} /> Plan
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

export function FranchiseGuide({ mediaId }) {
  const [ref, seen] = useInView();
  const guide = useApi(`/anime/media/${mediaId}/franchise`, seen);
  const [mainOnly, setMainOnly] = useState(false);
  const [noRecaps, setNoRecaps] = useState(true);
  const items = guide.data?.items || [];
  if (seen && guide.data && items.length <= 1) return <div ref={ref} />;
  const shown = items.filter((it) => (!mainOnly || it.kind === 'main' || it.is_root) && (!noRecaps || !['recap', 'extra'].includes(it.kind) || it.is_root));
  const mains = items.filter((it) => it.kind === 'main');
  const finished = mains.filter((it) => it.list?.status === 'COMPLETED').length;
  let step = 0;
  return (
    <section ref={ref} className={`${x.block} ${x.guide}`}>
      <h3 className={x.label}><Radio size={12} /> Watch order</h3>
      {!guide.data && (seen ? <Receiving label="tracing the franchise" /> : <p className={x.note}>…</p>)}
      {guide.error && <p className={x.note}>{guide.error}</p>}
      {items.length > 1 && (
        <>
          <div className={x.gBar}>
            <span className={x.note}>
              {items.length} entries · {mains.length} in the main story
              {mains.length > 0 && guide.data.items.some((it) => it.list) ? ` · you've finished ${finished} of ${mains.length}` : ''}
            </span>
            <label className={x.gToggle}><input type="checkbox" checked={mainOnly} onChange={(e) => setMainOnly(e.target.checked)} /> main story only</label>
            <label className={x.gToggle}><input type="checkbox" checked={noRecaps} onChange={(e) => setNoRecaps(e.target.checked)} /> hide recaps & extras</label>
          </div>
          <ol className={x.gList}>
            {shown.map((it) => <GuideItem key={it.id} it={it} step={it.kind === 'main' ? (step += 1) : null} />)}
          </ol>
          <p className={x.note}>
            In release order — the order most guides settle on.{guide.data.truncated ? ' This franchise is huge; the guide shows the part nearest this title.' : ''}
          </p>
        </>
      )}
    </section>
  );
}
