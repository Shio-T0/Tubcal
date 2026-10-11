// The Ledger — your anime life, kept like accounts.
//
// Deliberately its own texture in the room: Browse is a poster wall, Seasons a
// program guide, the Schedule a timetable; this is a bookkeeper's ledger — ruled
// folios, mono numerals, one hero figure. Everything is computed server-side from
// your list itself (AniList's own statistics come back empty for some accounts),
// with AniList's precomputed voice-actor/staff tallies folded in where present.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Clapperboard, Scale, Search, Sparkles, Users } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { Button, EmptyState, SegmentedControl } from '../ui/index.jsx';
import { useAnimeSync, useToast } from '../../state.jsx';
import { BarList, ChartTable, Columns, Dumbbell, StatTile } from './charts.jsx';
import {
  COUNTRY_LABEL, MONTH_SHORT, SOURCE_LABEL, STATUS_LABEL, fmtDuration, formatLabel, useParamState,
} from './shared.jsx';
import l from './ledger.module.css';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** A 0–100 score shown in the viewer's own AniList format. */
export function inFormat(n, fmt) {
  if (n == null) return '—';
  switch (fmt) {
    case 'POINT_100': return String(Math.round(n));
    case 'POINT_5': return `${(n / 20).toFixed(1)}★`;
    case 'POINT_3': return (n / 33.34).toFixed(1);
    default: return (n / 10).toFixed(1); // POINT_10 / POINT_10_DECIMAL
  }
}

function Folio({ n, title, note, wide, children, id }) {
  return (
    <section className={`${l.folio} ${wide ? l.folioWide : ''}`} id={id}>
      <header className={l.folioHead}>
        <span className={l.folioNo}>Folio {ROMAN[n] || n + 1}</span>
        <h3 className={l.folioTitle}>{title}</h3>
        {note && <p className={l.folioNote}>{note}</p>}
      </header>
      {children}
    </section>
  );
}

const hours = (m) => `${Math.round((m || 0) / 60).toLocaleString()}h`;

/** Genres or tags, switchable between how many, how long, and how much you liked them. */
function Breakdown({ rows, labelKey, fmt, limit = 12, linkKey }) {
  const [by, setBy] = useState('count');
  const sorted = [...(rows || [])]
    .filter((r) => (by === 'mean' ? r.mean != null : true))
    .sort((a, b) => (by === 'count' ? b.count - a.count : by === 'minutes' ? b.minutes - a.minutes : (b.mean || 0) - (a.mean || 0)));
  const value = by === 'count' ? (r) => r.count : by === 'minutes' ? (r) => r.minutes : (r) => r.mean || 0;
  const format = by === 'count' ? (v) => v : by === 'minutes' ? hours : (v) => inFormat(v, fmt);
  return (
    <>
      <div className={l.dial}>
        <SegmentedControl
          options={[{ value: 'count', label: 'Titles' }, { value: 'minutes', label: 'Hours' }, { value: 'mean', label: 'Your mean' }]}
          value={by}
          onChange={setBy}
        />
      </div>
      <BarList
        rows={sorted}
        label={(r) => r[labelKey]}
        value={value}
        format={format}
        limit={limit}
        href={linkKey ? (r) => `/anime?tab=browse&${linkKey}=${encodeURIComponent(r[labelKey])}` : undefined}
        tip={(r) => `${r.count} titles · ${hours(r.minutes)} watched${r.mean != null ? ` · your mean ${inFormat(r.mean, fmt)}` : ''}`}
      />
      <ChartTable
        columns={[
          { key: labelKey, label: labelKey },
          { key: 'count', label: 'titles' },
          { key: 'minutes', label: 'hours', render: (r) => hours(r.minutes) },
          { key: 'mean', label: 'your mean', render: (r) => inFormat(r.mean, fmt) },
        ]}
        rows={sorted}
      />
    </>
  );
}

/** The year in review, for any year you finished something in. */
function Wrapped({ wrapped, fmt }) {
  const years = Object.keys(wrapped || {}).sort().reverse();
  const [year, setYear] = useState(years[0]);
  if (!years.length) {
    return <p className={l.muted}>Add finish dates to completed titles and each year gets its own review here.</p>;
  }
  const y = wrapped[year] || wrapped[years[0]];
  const busiest = y.months.indexOf(Math.max(...y.months));
  return (
    <div className={l.wrapped}>
      <div className={l.yearPills} role="tablist" aria-label="Year">
        {years.map((yr) => (
          <button key={yr} role="tab" aria-selected={yr === year} className={yr === year ? l.yearOn : l.year} onClick={() => setYear(yr)}>
            {yr}
          </button>
        ))}
      </div>
      <div className={l.wrapGrid}>
        <div className={l.wrapLead}>
          <span className={l.wrapBig}>{y.completed}</span>
          <span className={l.wrapBigLabel}>titles finished in {year}</span>
          <span className={l.wrapLine}>{fmtDuration(y.minutes)} of watching · busiest in {MONTH_SHORT[busiest]}</span>
          {y.genres.length > 0 && (
            <span className={l.wrapLine}>mostly {y.genres.slice(0, 3).join(', ')}</span>
          )}
          <span className={l.wrapBookends}>
            opened with <Link to={`/anime/${y.first.id}`}>{y.first.title}</Link>, closed with{' '}
            <Link to={`/anime/${y.last.id}`}>{y.last.title}</Link>
          </span>
        </div>
        <div className={l.wrapMonths}>
          <span className={l.subhead}>Finished per month</span>
          <Columns
            data={y.months.map((v, i) => ({ key: i, label: MONTH_SHORT[i][0], value: v }))}
            height={96}
            tip={(d) => `${MONTH_SHORT[d.key]} ${year}: ${d.value} finished`}
            ariaLabel={`Titles finished per month in ${year}`}
          />
        </div>
      </div>
      {y.best.length > 0 && (
        <>
          <span className={l.subhead}>Your best of {year}</span>
          <div className={l.bestRow}>
            {y.best.map((m, i) => (
              <Link key={m.id} to={`/anime/${m.id}`} className={l.best} style={{ '--i': i }}>
                <span className={l.bestRank}>{i + 1}</span>
                {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <span className={l.bestFallback} />}
                <span className={l.bestTitle}>{m.title}</span>
                {m.mine > 0 && <span className={l.bestScore}>{inFormat(m.mine, fmt)}</span>}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PosterPicks({ rows, label, fmt }) {
  const { queueListEdit } = useAnimeSync();
  const toast = useToast();
  if (!rows?.length) return null;
  return (
    <div className={l.picks}>
      <span className={l.subhead}>{label}</span>
      <div className={l.pickRow}>
        {rows.map((r) => (
          <div key={r.media.id} className={l.pick}>
            <Link to={`/anime/${r.media.id}`} className={l.pickCover}>
              {r.media.cover ? <img src={r.media.cover} alt="" loading="lazy" /> : <span />}
              <span className={l.pickScore}>{inFormat(r.score, fmt)}</span>
            </Link>
            <Link to={`/anime/${r.media.id}`} className={l.pickTitle}>{r.media.title}</Link>
            {r.planned ? (
              <span className={l.pickPlanned}>already planned</span>
            ) : (
              <button
                type="button"
                className={l.pickPlan}
                onClick={() => { queueListEdit(r.media, { status: 'PLANNING' }); toast(`“${r.media.title}” → Planning`, 'success'); }}
              >
                + Plan
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Taste compatibility with any AniList user — affinity is the correlation of the
 *  scores you both gave (MyAnimeList's number), overlap is genre-shape similarity. */
function Compare({ fmt, myId }) {
  // The target lives in the URL, so a profile's "Compare tastes" can link straight here.
  const [target, setTarget] = useParamState('cmp', '');
  const [name, setName] = useState(target);
  const ref = useRef(null);
  useEffect(() => {
    if (target) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [target]);
  const following = useApi(`/anime/follows/${myId}`, !!myId);
  const cmp = useApi(`/anime/compare/${encodeURIComponent(target)}`, !!target);
  const d = cmp.data;
  const friends = following.data?.items || [];

  return (
    <div className={l.compare} ref={ref}>
      <form className={l.compareForm} onSubmit={(e) => { e.preventDefault(); setTarget(name.trim()); }}>
        <Search size={14} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="an AniList username…"
          list="anime-compare-friends"
          spellCheck={false}
        />
        <datalist id="anime-compare-friends">
          {friends.map((f) => <option key={f.id} value={f.name} />)}
        </datalist>
        <Button type="submit" disabled={!name.trim()}>Compare</Button>
      </form>
      {friends.length > 0 && !target && (
        <div className={l.friendChips}>
          <span className={l.subhead}>People you follow</span>
          {friends.slice(0, 12).map((f) => (
            <button key={f.id} type="button" className={l.friend} onClick={() => { setName(f.name); setTarget(f.name); }}>
              <Avatar src={f.avatar} name={f.name} imgClass={l.friendAv} letterClass={l.friendAvL} /> {f.name}
            </button>
          ))}
        </div>
      )}

      {cmp.loading && <Receiving label={`reading ${target}'s list`} />}
      {cmp.error && <ErrorBox message={cmp.error} />}
      {d && (
        <div className={l.cmpResult}>
          <div className={l.cmpHead}>
            <span className={l.cmpWho}>
              <Avatar src={d.me.avatar} name={d.me.name} imgClass={l.cmpAv} letterClass={l.cmpAvL} />
              {d.me.name}
            </span>
            <span className={l.affinity}>
              <span className={l.affinityValue}>{d.affinity == null ? '—' : `${d.affinity}%`}</span>
              <span className={l.affinityLabel}>
                affinity{d.affinity == null ? ' — needs 3+ titles you both scored' : ` over ${d.pairs} shared scores`}
              </span>
            </span>
            <span className={l.cmpWho}>
              <Avatar src={d.them.avatar} name={d.them.name} imgClass={l.cmpAv} letterClass={l.cmpAvL} />
              {d.them.name}
            </span>
          </div>
          <div className={l.tiles}>
            <StatTile label="Seen by both" value={d.shared} hint={`of your ${d.mine_count} · their ${d.their_count}`} />
            <StatTile label="Average score gap" value={d.mean_diff == null ? '—' : inFormat(d.mean_diff, fmt === 'POINT_100' ? fmt : 'POINT_10')} hint="points apart on shared titles" />
            <StatTile label="Genre overlap" value={d.genre_similarity == null ? '—' : `${d.genre_similarity}%`} hint={d.shared_genres.slice(0, 3).join(', ') || 'no common genres'} />
          </div>
          {d.disagreements.length > 0 && (
            <>
              <span className={l.subhead}>Where you part ways</span>
              <Dumbbell
                aName="You"
                bName={d.them.name}
                rows={d.disagreements.map((x) => ({
                  key: x.media.id, label: x.media.title, cover: x.media.cover,
                  href: `/anime/${x.media.id}`, a: x.mine, b: x.theirs,
                }))}
              />
            </>
          )}
          {d.shared_loves.length > 0 && (
            <>
              <span className={l.subhead}>You both loved</span>
              <div className={l.lovesRow}>
                {d.shared_loves.map((x) => (
                  <Link key={x.media.id} to={`/anime/${x.media.id}`} className={l.love} title={x.media.title}>
                    {x.media.cover && <img src={x.media.cover} alt="" loading="lazy" />}
                  </Link>
                ))}
              </div>
            </>
          )}
          <PosterPicks rows={d.their_picks} label={`${d.them.name}'s favourites you haven't seen`} fmt="POINT_100" />
          <PosterPicks rows={d.my_picks} label={`Yours they haven't seen — send them these`} fmt="POINT_100" />
        </div>
      )}
    </div>
  );
}

export default function Ledger() {
  const stats = useApi('/anime/stats');
  const me = useApi('/anime/me');
  const { hash } = useLocation();
  const fmt = me.data?.score_format;
  const d = stats.data;
  // The index links straight to a folio (#takes, #wrapped, #compare); once the
  // ledger has drawn, bring that folio into view.
  useEffect(() => {
    if (!d || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [d, hash]);

  if (stats.loading && !d) return <Receiving label="totting up the ledger" />;
  if (stats.error) {
    if (/connect|401|reconnect/i.test(stats.error)) {
      return (
        <EmptyState
          icon={<Scale size={32} />}
          color="var(--c-anime)"
          title="Connect AniList to open your ledger"
          subtitle="Your statistics, year in review and taste comparisons are all worked out from your AniList list."
          action={<Button onClick={() => (window.location.href = '/settings?s=accounts')}>Open Settings</Button>}
        />
      );
    }
    return <ErrorBox message={stats.error} />;
  }
  if (!d) return null;
  const t = d.totals;

  return (
    <div className={l.ledger}>
      <header className={l.hero}>
        <div className={l.heroFigure}>
          <span className={l.heroValue}>{t.days.toLocaleString()}</span>
          <span className={l.heroLabel}>days of anime watched</span>
          <span className={l.heroSub}>{t.episodes.toLocaleString()} episodes across {t.watched.toLocaleString()} titles</span>
        </div>
        <div className={l.tiles}>
          <StatTile label="Mean score" value={inFormat(t.mean_score, fmt)} hint={t.std_dev != null ? `± ${inFormat(t.std_dev, fmt === 'POINT_100' ? fmt : 'POINT_10')} spread · ${t.scored} scored` : `${t.scored} scored`} />
          <StatTile label="Completed" value={t.completed.toLocaleString()} hint={t.completion_rate != null ? `${t.completion_rate}% of what you ended, you finished` : null} />
          <StatTile label="Rewatches" value={t.rewatches} />
          <StatTile
            label="Backlog"
            value={fmtDuration(t.backlog_minutes)}
            accent
            hint={`${t.planning} planned${t.backlog_guessed ? ` · ${t.backlog_guessed} estimated` : ''} · ~${Math.ceil(t.backlog_minutes / 60)} evenings at 1h`}
          />
        </div>
      </header>

      <div className={l.folios}>
        <Folio n={0} title="Where everything stands" note="Every title on your list, by shelf.">
          <BarList
            rows={d.statuses.map((x) => ({ key: x.status, label: STATUS_LABEL[x.status] || x.status, value: x.count }))}
            href={(r) => `/anime?tab=list&shelf=${r.key}`}
          />
        </Folio>

        <Folio n={1} title="How you score" note={`Your scores, bucketed on a 100-point scale. You score like ${t.std_dev > 15 ? 'a critic — wide range' : 'a fan — mostly kind'}.`}>
          <Columns
            data={d.scores.map((x) => ({ key: x.score, label: String(x.score), value: x.count }))}
            tip={(x) => `${x.value} titles scored ${x.key - 9}–${x.key}`}
            ariaLabel="Score distribution"
          />
          <ChartTable columns={[{ key: 'score', label: 'score' }, { key: 'count', label: 'titles' }]} rows={d.scores} />
        </Folio>

        <Folio n={2} title="Genres" note="What you actually spend your evenings on." wide>
          <Breakdown rows={d.genres} labelKey="genre" fmt={fmt} linkKey="g" />
        </Folio>

        <Folio n={3} title="Themes & tags" note="The finer grain — tags AniList ranks 60%+ relevant, spoilers excluded.">
          <Breakdown rows={d.tags} labelKey="tag" fmt={fmt} limit={10} linkKey="t" />
        </Folio>

        <Folio n={4} title="Studios" note="The houses whose work you keep coming back to.">
          <BarList
            rows={d.studios.map((x) => ({ key: x.studio, label: x.studio, value: x.count, ...x }))}
            tip={(r) => `${r.count} titles · ${hours(r.minutes)}${r.mean != null ? ` · your mean ${inFormat(r.mean, fmt)}` : ''}`}
            limit={8}
          />
        </Folio>

        <Folio n={5} title="Length & form">
          <span className={l.subhead}>Episodes per title</span>
          <Columns
            data={d.lengths.map((x) => ({ key: x.length, label: x.length, value: x.count }))}
            height={92}
            tip={(x) => `${x.value} titles with ${x.key} episodes`}
            ariaLabel="Titles by episode count"
          />
          <span className={l.subhead}>Format</span>
          <BarList rows={d.formats.map((x) => ({ key: x.format, label: formatLabel(x.format), value: x.count, ...x }))}
                   tip={(r) => `${hours(r.minutes)} watched`} />
        </Folio>

        <Folio n={6} title="Eras" note="When the things you watch first aired." wide>
          <Columns
            data={d.release_years.map((x) => ({ key: x.year, label: `'${String(x.year).slice(2)}`, value: x.count, mean: x.mean }))}
            height={110}
            tip={(x) => `${x.key}: ${x.value} titles${x.mean != null ? ` · your mean ${inFormat(x.mean, fmt)}` : ''}`}
            ariaLabel="Titles by release year"
          />
          <ChartTable columns={[{ key: 'year', label: 'year' }, { key: 'count', label: 'titles' }, { key: 'mean', label: 'your mean', render: (r) => inFormat(r.mean, fmt) }]} rows={d.release_years} />
        </Folio>

        <Folio n={7} title="Origins">
          <span className={l.subhead}>Adapted from</span>
          <BarList rows={d.sources.map((x) => ({ key: x.source, label: SOURCE_LABEL[x.source] || x.source, value: x.count }))} limit={6} />
          <span className={l.subhead}>Made in</span>
          <BarList rows={d.countries.map((x) => ({ key: x.country, label: COUNTRY_LABEL[x.country] || x.country, value: x.count }))} />
        </Folio>

        {(d.voice_actors?.length > 0 || d.staff?.length > 0) && (
          <Folio n={8} title="The voices & hands" note="AniList's own tally of who turns up most in what you watch." wide>
            <div className={l.people}>
              {[['Voice actors', d.voice_actors], ['Staff', d.staff]].map(([label, rows]) => rows?.length > 0 && (
                <div key={label}>
                  <span className={l.subhead}>{label}</span>
                  <ol className={l.personList}>
                    {rows.map((p) => (
                      <li key={p.id}>
                        <Link to={`/anime/voice/${p.id}`} className={l.person}>
                          <Avatar src={p.image} name={p.name} imgClass={l.personAv} letterClass={l.personAvL} />
                          <span className={l.personName}>{p.name}{p.role && <em>{p.role}</em>}</span>
                          <span className={l.personCount}>{p.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Folio>
        )}

        <Folio n={9} title="Hot takes" note="Where your score strays furthest from the AniList average." wide id="takes">
          {d.hot_takes.higher.length + d.hot_takes.lower.length === 0 ? (
            <p className={l.muted}>You score in step with the crowd — nothing strays 10 points or more.</p>
          ) : (
            <div className={l.takes}>
              {d.hot_takes.higher.length > 0 && (
                <div>
                  <span className={l.subhead}><Sparkles size={11} /> You rate higher than most</span>
                  <Dumbbell rows={d.hot_takes.higher.map((x) => ({
                    key: x.media.id, label: x.media.title, cover: x.media.cover, href: `/anime/${x.media.id}`,
                    a: Math.round(x.mine), b: x.crowd,
                  }))} />
                </div>
              )}
              {d.hot_takes.lower.length > 0 && (
                <div>
                  <span className={l.subhead}><Users size={11} /> The crowd rates higher</span>
                  <Dumbbell rows={d.hot_takes.lower.map((x) => ({
                    key: x.media.id, label: x.media.title, cover: x.media.cover, href: `/anime/${x.media.id}`,
                    a: Math.round(x.mine), b: x.crowd,
                  }))} />
                </div>
              )}
            </div>
          )}
        </Folio>

        <Folio n={10} title="Year in review" note="Everything you finished, year by year." wide id="wrapped">
          <Wrapped wrapped={d.wrapped} fmt={fmt} />
        </Folio>

        <Folio n={11} title="Compare tastes" note="Line your list up against anyone's on AniList." wide id="compare">
          <Compare fmt={fmt} myId={me.data?.id} />
        </Folio>
      </div>

      <p className={l.footnote}>
        <Clapperboard size={11} /> Worked out from your AniList list · refreshes whenever you change it
        <ArrowRight size={11} /> <Link to="/anime?tab=list">open the list</Link>
      </p>
    </div>
  );
}
