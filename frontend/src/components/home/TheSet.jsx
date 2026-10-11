// The set — the home screen's television, and the most useful thing on it.
//
// Its screen is tuned to whatever you'd pick up next: a video you left halfway,
// the next episode of a show you're watching, or (when that runs short) what's
// just come in from your channels. The presets along the foot of the screen are
// the rest of that queue: hover or focus one and the set tunes to it, press it and
// it plays. The side panel is the cabinet's control strip: a clock in a glowing
// window, the two channel knobs (1 the Hub, 2 the Anime), a slip of what's coming
// up — streams live now, premieres, your shows' next episodes — and the speaker
// grille with the maker's plate.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Loader2, Play, Radio, RotateCcw, Tv } from 'lucide-react';

import { usePlayer } from '../../state.jsx';
import { ago, clock } from '../../lib/time.js';
import { ANIME_HOME, HUB_HOME } from '../../lib/rooms.js';
import { usePlayEpisode } from '../anime/watching.js';
import { slotLabel } from './lineup.js';
import s from './set.module.css';

// ── what a queue entry looks like on screen ──────────────────────────────────

/** Everything the screen and a preset need to show one entry of the queue. */
function describe(x) {
  if (x.kind === 'anime') {
    const { m, w } = x;
    const resuming = w.resumeAt != null;
    const of = w.total ? ` of ${w.total}` : '';
    const tail = resuming
      ? ` · ${clock(w.remainingOfNext)} left`
      : w.left > 1 ? ` · ${w.left} waiting` : '';
    return {
      kicker: resuming ? 'Pick up where you left off' : w.status === 'REPEATING' ? 'Rewatching' : 'Next on your list',
      tone: m.color || 'var(--c-anime)',
      title: m.title,
      meta: `Episode ${w.nextN}${of}${tail}`,
      picture: m.banner || m.cover_xl || m.cover,
      poster: m.banner ? m.cover_xl || m.cover : null, // the case, set on the banner
      ambient: m.banner || m.cover_xl || m.cover,
      ratio: resuming
        ? w.resumeAt / (w.resumeAt + (w.remainingOfNext || 1))
        : w.watched / Math.max(1, w.total || w.aired),
      label: resuming ? `Resume ep ${w.nextN}` : `Play ep ${w.nextN}`,
      icon: resuming ? RotateCcw : Play,
      href: `/anime/${m.id}`,
      hrefLabel: 'Title page',
      short: `${m.title} · ep ${w.nextN}`,
    };
  }
  const { item } = x;
  const p = x.p;
  const started = p?.duration > 0 && p.position > 5;
  const cid = item.extra?.channel_id;
  return {
    kicker: x.kind === 'fresh' ? (x.isNew ? 'Just in' : 'From your channels') : 'Pick up where you left off',
    tone: 'var(--c-youtube)',
    title: item.title,
    meta: [
      item.source,
      started ? `${clock(p.duration - p.position)} left` : item.published_at ? ago(item.published_at) : null,
    ].filter(Boolean).join(' · '),
    picture: item.thumbnail,
    poster: null,
    ambient: item.thumbnail,
    ratio: started ? p.position / p.duration : 0,
    label: started ? `Resume at ${clock(p.position)}` : 'Play',
    icon: started ? RotateCcw : Play,
    href: cid ? `/youtube/c/${cid}` : '/youtube',
    hrefLabel: cid ? 'Channel' : 'Screening Room',
    short: item.title,
  };
}

/** Play a queue entry: a video straight into the player, an episode through the
 *  title's episode list (which can take a moment, hence `busy`). */
function usePlayEntry() {
  const { open } = usePlayer();
  const playEpisode = usePlayEpisode();
  const [busy, setBusy] = useState(null);
  const play = async (x) => {
    if (x.kind !== 'anime') { open(x.item); return; }
    if (busy) return;
    setBusy(x.key);
    await playEpisode(x.m, x.w.nextN);
    setBusy(null);
  };
  return { play, busy };
}

// ── the screen ───────────────────────────────────────────────────────────────

/** The tuned picture's glow, thrown across the whole tube. The previous glow
 *  stays underneath while the next fades in, so changing channel never dips. */
function Ambient({ src }) {
  const [layers, setLayers] = useState([]);
  useEffect(() => {
    if (!src) return;
    setLayers((ls) => (ls.at(-1)?.src === src ? ls : [...ls.slice(-1), { src, n: Date.now() }]));
  }, [src]);
  return (
    <div className={s.ambient} aria-hidden="true">
      {layers.map((l) => <img key={l.n} src={l.src} alt="" />)}
    </div>
  );
}

function Picture({ v, onPlay, busy }) {
  const Icon = v.icon;
  return (
    <button type="button" className={s.picture} onClick={onPlay} aria-label={v.label} tabIndex={-1}>
      {v.picture ? <img src={v.picture} alt="" className={`${s.pictureImg} ${v.poster ? s.banner : ''}`} /> : <Tv size={34} />}
      {v.poster && <img src={v.poster} alt="" className={s.case} />}
      <span className={s.glyph}>{busy ? <Loader2 size={26} className={s.spin} /> : <Icon size={26} fill={Icon === Play ? 'currentColor' : 'none'} />}</span>
      {v.ratio > 0 && (
        <span className={s.bar} aria-hidden="true"><i style={{ '--w': Math.min(1, v.ratio) }} /></span>
      )}
    </button>
  );
}

function Programme({ x, onPlay, busy }) {
  const v = describe(x);
  const Icon = v.icon;
  return (
    <div className={s.programme} style={{ '--tone': v.tone }}>
      <Picture v={v} onPlay={onPlay} busy={busy} />
      <div className={s.caption}>
        <span className={s.kicker}><i className={s.lamp} />{v.kicker}</span>
        <h2 className={s.title} title={v.title}>{v.title}</h2>
        {v.meta && <p className={s.meta}>{v.meta}</p>}
        <div className={s.acts}>
          <button type="button" className={s.go} onClick={onPlay} disabled={busy}>
            {busy ? <Loader2 size={15} className={s.spin} /> : <Icon size={15} fill={Icon === Play ? 'currentColor' : 'none'} />}
            {v.label}
          </button>
          <Link to={v.href} className={s.aside}>{v.hrefLabel}</Link>
        </div>
      </div>
    </div>
  );
}

/** Nothing to pick up and nothing new: the station's test card. */
function TestCard() {
  return (
    <div className={s.testcard}>
      <div className={s.bars} aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
      </div>
      <div className={s.testLine}>
        <strong>Nothing on just now</strong>
        <span>Half-watched videos and your shows' next episodes queue up here. Turn a knob to start.</span>
      </div>
    </div>
  );
}

function Screen({ items, loading }) {
  const [tunedKey, setTunedKey] = useState(null);
  const timer = useRef(0);
  const { play, busy } = usePlayEntry();
  const tuned = items.find((x) => x.key === tunedKey) || items[0] || null;

  useEffect(() => () => clearTimeout(timer.current), []);
  // Sweeping the pointer across the presets shouldn't flick through every one.
  const tuneSoon = (key) => { clearTimeout(timer.current); timer.current = setTimeout(() => setTunedKey(key), 110); };
  const tuneNow = (key) => { clearTimeout(timer.current); setTunedKey(key); };

  let body;
  if (tuned) body = <Programme key={tuned.key} x={tuned} onPlay={() => play(tuned)} busy={busy === tuned.key} />;
  else if (loading) body = <div className={s.tuning}><span>Tuning in…</span></div>;
  else body = <TestCard />;

  return (
    <div className={s.screen}>
      <Ambient src={tuned ? describe(tuned).ambient : null} />
      <div className={s.tube}>
        {body}
        {items.length > 1 && (
          <div className={s.presets} onMouseLeave={() => clearTimeout(timer.current)}>
            {items.map((x, i) => {
              const v = describe(x);
              const on = x.key === tuned?.key;
              return (
                <button
                  key={x.key}
                  type="button"
                  className={`${s.preset} ${on ? s.presetOn : ''}`}
                  style={{ '--i': i, '--tone': v.tone }}
                  onMouseEnter={() => tuneSoon(x.key)}
                  onFocus={() => tuneNow(x.key)}
                  onClick={() => play(x)}
                  aria-label={`${v.label}: ${v.short}`}
                  aria-current={on || undefined}
                  title={v.short}
                  data-kbd-tile
                >
                  <span className={s.presetPic}>
                    {v.picture ? <img src={v.picture} alt="" loading="lazy" /> : <Tv size={16} />}
                    {busy === x.key && <span className={s.presetBusy}><Loader2 size={16} className={s.spin} /></span>}
                    {v.ratio > 0 && <span className={s.bar}><i style={{ '--w': Math.min(1, v.ratio) }} /></span>}
                  </span>
                  <span className={s.presetName}>{v.short}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* a burst of static each time the set changes channel */}
      <span key={tuned?.key || 'off'} className={s.static} aria-hidden="true" />
      <span className={s.scan} aria-hidden="true" />
      <span className={s.glass} aria-hidden="true" />
    </div>
  );
}

// ── the control strip ────────────────────────────────────────────────────────

/** The clock, lit like a radio's display. Each digit drops in when it changes. */
function Clock({ now }) {
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type)?.value || '';
  const hh = part('hour');
  const mm = part('minute');
  const period = part('dayPeriod');
  const zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' ');
  const digits = (str, pre) => [...str].map((d, i) => (
    <span key={`${pre}${i}${d}`} className={s.digit} style={{ '--i': pre === 'm' ? i + 2 : i }}>{d}</span>
  ));
  return (
    <div className={s.vfd}>
      <time className={s.time} dateTime={now.toISOString()} aria-label={now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}>
        {/* the unlit segments behind the lit ones */}
        <span className={s.ghost} aria-hidden="true">
          {[...hh].map((_, i) => <span key={i} className={s.digit}>8</span>)}
          <span className={s.colon}>:</span>
          {[...mm].map((_, i) => <span key={i} className={s.digit}>8</span>)}
        </span>
        <span className={s.lit} aria-hidden="true">
          {digits(hh, 'h')}
          <span className={s.colon}>:</span>
          {digits(mm, 'm')}
        </span>
        {period && <span className={s.period} aria-hidden="true">{period}</span>}
      </time>
      <span className={s.zone}>{zone || 'local time'}</span>
    </div>
  );
}

function Knob({ n, label, sub, to, tone }) {
  return (
    <Link to={to} className={s.knob} style={{ '--tone': tone }} data-kbd-tile aria-keyshortcuts={String(n)}>
      <span className={s.knobFace}><span>{n}</span></span>
      <span className={s.knobText}>
        <span className={s.knobLabel}>{label}</span>
        <span className={s.knobSub}>{sub}</span>
      </span>
    </Link>
  );
}

function GuideRow({ r, now, i }) {
  const { open } = usePlayer();
  const style = { '--i': i };
  if (r.kind === 'live') {
    return (
      <li style={style}>
        <button type="button" className={`${s.slot} ${s.slotLive}`} onClick={() => open(r.item)} data-kbd-tile title={r.item.title}>
          <span className={s.when}><b>Live</b><span>now</span></span>
          <span className={s.pin} />
          <span className={s.what}>
            <span className={s.whatTitle}>{r.item.title}</span>
            <span className={s.whatSub}><Radio size={11} /> {r.item.source}</span>
          </span>
        </button>
      </li>
    );
  }
  const slot = slotLabel(r.at, now);
  const isAnime = r.kind === 'episode' || r.kind === 'premiere';
  const title = isAnime ? r.m.title : r.item.title;
  const sub = isAnime
    ? r.kind === 'premiere' ? 'Premiere · episode 1' : `Episode ${r.m.next_episode}`
    : r.item.source;
  return (
    <li style={style}>
      <Link
        to={isAnime ? `/anime/${r.m.id}` : '/youtube?v=live'}
        className={s.slot}
        style={isAnime && r.m.color ? { '--tone': r.m.color } : undefined}
        data-kbd-tile
        title={`${title} — ${new Date(r.at * 1000).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`}
      >
        <span className={s.when}><b>{slot.time}</b><span>{slot.day}</span></span>
        <span className={s.pin} />
        <span className={s.what}>
          <span className={s.whatTitle}>{title}</span>
          <span className={s.whatSub}>{!isAnime && <CalendarClock size={11} />} {sub}</span>
        </span>
      </Link>
    </li>
  );
}

function ComingUp({ rows, now, ready }) {
  const shown = rows.slice(0, 4);
  return (
    <div className={s.slip}>
      <div className={s.slipHead}>
        <span>Coming up</span>
        {rows.length > shown.length && <span>+{rows.length - shown.length} more this week</span>}
      </div>
      {shown.length > 0 ? (
        <ol className={s.slots}>
          {shown.map((r, i) => <GuideRow key={r.key} r={r} now={now} i={i} />)}
        </ol>
      ) : (
        <p className={s.slipEmpty}>{ready ? 'Nothing scheduled this week.' : 'Reading the schedule…'}</p>
      )}
    </div>
  );
}

export default function TheSet({ pickUp, comingUp, comingReady, now, hubSub, animeSub }) {
  return (
    <section className={s.set} aria-label="Pick up where you left off">
      <Screen items={pickUp.items} loading={pickUp.loading} />
      <aside className={s.panel} aria-label="Clock, channels and what's coming up">
        <Clock now={now} />
        <div className={s.knobs}>
          <Knob n={1} label="Hub" sub={hubSub} to={HUB_HOME} tone="var(--signal)" />
          <Knob n={2} label="Anime" sub={animeSub} to={ANIME_HOME} tone="var(--accent-strong)" />
        </div>
        <ComingUp rows={comingUp} now={now} ready={comingReady} />
        <div className={s.grille} aria-hidden="true">
          <span className={`${s.plate} tc-wordmark`}>Tubcal<em>.</em></span>
        </div>
      </aside>
    </section>
  );
}
