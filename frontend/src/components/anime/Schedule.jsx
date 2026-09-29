// Schedule — the week's timetable.
//
// A TV guide's grid: seven day-columns split at *your* midnight, each episode a
// slot stamped with its local air time, the shows on your list inked in, and a
// "now" line through today. The week can be exported as an .ics file, so the
// shows you follow land in whatever calendar you actually look at.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Tv } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { applyOverlay, useAnimeSync } from '../../state.jsx';
import { STATUS_LABEL, fmtDuration, useParamState } from './shared.jsx';
import { useAnimeCalc } from './WatchCalculator.jsx';
import t from './schedule.module.css';

const DAY_MS = 86_400_000;

/** Local Monday 00:00 of the week `offset` weeks from this one. */
function weekStart(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow + offset * 7);
  return d;
}

const timeLabel = (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── .ics export ────────────────────────────────────────────────────────────────
const icsDate = (sec) => new Date(sec * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');

export function buildIcs(slots, label = 'Tubcal — anime schedule') {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tubcal//Anime schedule//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(label)}`,
  ];
  const stamp = icsDate(Date.now() / 1000);
  for (const s of slots) {
    const m = s.media;
    const mins = m.duration || 24;
    lines.push(
      'BEGIN:VEVENT',
      `UID:anilist-airing-${s.id}@tubcal.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(s.airing_at)}`,
      `DTEND:${icsDate(s.airing_at + mins * 60)}`,
      `SUMMARY:${icsText(`${m.title} — Episode ${s.episode}${m.episodes ? `/${m.episodes}` : ''}`)}`,
      `DESCRIPTION:${icsText(`${m.title_native || ''}\nhttps://anilist.co/anime/${m.id}`)}`,
      `URL:https://anilist.co/anime/${m.id}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  // RFC 5545 wants CRLF line ends.
  return lines.join('\r\n');
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ── the grid ───────────────────────────────────────────────────────────────────

function Slot({ s, entry, now }) {
  const m = s.media;
  const { hoverProps } = useAnimeCalc();
  const past = s.airing_at * 1000 <= now;
  const soon = !past && s.airing_at * 1000 - now < DAY_MS;
  const behind = entry && ['CURRENT', 'REPEATING'].includes(entry.status)
    ? Math.max(0, s.episode - 1 - (entry.progress || 0)) : 0;
  const mins = Math.max(0, Math.round((s.airing_at * 1000 - now) / 60000));
  return (
    <Link
      to={`/anime/${m.id}`}
      className={`${t.slot} ${past ? t.past : ''} ${entry ? t.mine : ''}`}
      style={{ '--cover-c': m.color || 'var(--c-anime)' }}
      {...hoverProps(m)}
    >
      <span className={t.time}>{timeLabel(s.airing_at)}</span>
      <span className={t.thumb}>
        {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <Tv size={14} />}
      </span>
      <span className={t.info}>
        <span className={t.title}>{m.title}</span>
        <span className={t.ep}>
          Ep {s.episode}{m.episodes ? <i>/{m.episodes}</i> : null}
          {s.episode === 1 && <b className={t.premiere}>premiere</b>}
          {m.episodes && s.episode === m.episodes && <b className={t.finale}>finale</b>}
        </span>
        {entry && (
          <span className={t.status}>
            {STATUS_LABEL[entry.status] || 'On list'}
            {behind > 0 && ` · ${behind} behind`}
          </span>
        )}
        {soon && <span className={t.soon}>in {mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}</span>}
      </span>
    </Link>
  );
}

export default function Schedule() {
  const [wkRaw, setWk] = useParamState('wk', '0');
  const [mine, setMine] = useParamState('tmine', '0');
  const wk = Number.parseInt(wkRaw, 10) || 0;
  const start = weekStart(wk);
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = Math.floor(weekStart(wk + 1).getTime() / 1000);
  const sched = useApi(`/anime/schedule?start=${startSec}&end=${endSec}`);
  const { overlay } = useAnimeSync();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);

  const slots = useMemo(() => {
    const all = (sched.data?.items || []).map((s) => ({ ...s, entry: applyOverlay(s.media.id, s.media.list_entry, overlay) }));
    return mine === '1' ? all.filter((s) => s.entry) : all;
  }, [sched.data, overlay, mine]);

  const days = useMemo(() => {
    const out = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { date: d, slots: [] };
    });
    for (const s of slots) {
      const i = Math.floor((s.airing_at * 1000 - start.getTime()) / DAY_MS);
      // DST shifts a day by an hour; clamp into the week rather than drop a slot
      out[Math.max(0, Math.min(6, i))].slots.push(s);
    }
    return out;
  }, [slots, startSec]); // eslint-disable-line react-hooks/exhaustive-deps

  const minePlain = slots.filter((s) => s.entry && ['CURRENT', 'REPEATING', 'PLANNING'].includes(s.entry.status));
  const myMinutes = minePlain.reduce((n, s) => n + (s.media.duration || 24), 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeLabel = `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${
    new Date(endSec * 1000 - 1).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  const exportIcs = () => {
    const pick = mine === '1' ? slots : (minePlain.length ? minePlain : slots);
    download(`anime-week-${start.toISOString().slice(0, 10)}.ics`, buildIcs(pick), 'text/calendar');
  };

  return (
    <div className={t.timetable}>
      <header className={t.bar}>
        <div className={t.weekNav}>
          <button type="button" onClick={() => setWk(String(wk - 1))} aria-label="Previous week"><ChevronLeft size={18} /></button>
          <span className={t.week}>
            <CalendarDays size={15} />
            <strong>{wk === 0 ? 'This week' : wk === 1 ? 'Next week' : wk === -1 ? 'Last week' : 'Week of'}</strong>
            <em>{rangeLabel}</em>
          </span>
          <button type="button" onClick={() => setWk(String(wk + 1))} aria-label="Next week"><ChevronRight size={18} /></button>
          {wk !== 0 && <button type="button" className={t.today} onClick={() => setWk('0')}>today</button>}
        </div>
        <div className={t.tools}>
          <label className={t.toggle}>
            <input type="checkbox" checked={mine === '1'} onChange={(e) => setMine(e.target.checked ? '1' : '0')} />
            only shows on my list
          </label>
          <button type="button" className={t.ics} onClick={exportIcs} disabled={!slots.length}
                  title={mine === '1' || !minePlain.length ? 'Download the slots shown as a calendar file' : 'Download the shows you watch or plan as a calendar file'}>
            <Download size={14} /> .ics
          </button>
        </div>
      </header>

      {minePlain.length > 0 && (
        <p className={t.summary}>
          <b>{minePlain.length}</b> episode{minePlain.length === 1 ? '' : 's'} of shows you follow air this week
          · about <b>{fmtDuration(myMinutes)}</b> of watching
        </p>
      )}
      {sched.data?.partial && (
        <p className={t.partial}>AniList is rate-limiting — part of the week is still missing. It fills in on the next look.</p>
      )}
      {sched.error && <ErrorBox message={sched.error} />}
      {sched.loading && !sched.data && <Receiving label="setting the timetable" />}

      {sched.data && (
        <div className={t.grid}>
          {days.map(({ date, slots: daySlots }) => {
            const isToday = date.getTime() === today.getTime();
            const nowIdx = isToday ? daySlots.findIndex((s) => s.airing_at * 1000 > now) : -1;
            return (
              <section key={date.getTime()} className={`${t.day} ${isToday ? t.isToday : ''}`}>
                <h3 className={t.dayHead}>
                  <span className={t.dow}>{date.toLocaleDateString([], { weekday: 'short' })}</span>
                  <span className={t.dom}>{date.getDate()}</span>
                  {isToday && <span className={t.todayTag}>today</span>}
                  <span className={t.dayCount}>{daySlots.length || ''}</span>
                </h3>
                <div className={t.slots}>
                  {daySlots.length === 0 && <span className={t.none}>— nothing airs —</span>}
                  {daySlots.map((s, i) => (
                    <div key={s.id} className={t.slotWrap}>
                      {i === nowIdx && <div className={t.nowLine}><span>now</span></div>}
                      <Slot s={s} entry={s.entry} now={now} />
                    </div>
                  ))}
                  {isToday && nowIdx === -1 && daySlots.length > 0 && <div className={t.nowLine}><span>now</span></div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
