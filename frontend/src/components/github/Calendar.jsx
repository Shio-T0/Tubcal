// A year of contributions as GitHub draws it — a week per column, Sunday on top —
// with the numbers worth knowing beside it: the total, the current and the longest
// streak, and the busiest day. `weeks` trims it to the most recent few.

import { useMemo } from 'react';

import g from './gh.module.css';

const CELL = 11;
const GAP = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utc(date) {
  return new Date(`${date}T00:00:00Z`);
}

export function streaks(days) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // The current streak may end yesterday: today isn't over.
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i -= 1;
  for (; i >= 0 && days[i].count > 0; i -= 1) current += 1;
  const best = days.reduce((b, d) => (d.count > (b?.count || 0) ? d : b), null);
  const active = days.filter((d) => d.count > 0).length;
  return { longest, current, best, active };
}

export default function Calendar({ data, weeks: keep, showStats = true }) {
  const model = useMemo(() => {
    let days = data?.days || [];
    if (!days.length) return null;
    if (keep) days = days.slice(-keep * 7 - utc(days[days.length - 1].date).getUTCDay());
    const first = utc(days[0].date).getUTCDay();
    const cells = days.map((d, i) => {
      const idx = i + first;
      return { ...d, col: Math.floor(idx / 7), row: idx % 7 };
    });
    const cols = cells[cells.length - 1].col + 1;
    const months = [];
    let last = -1;
    for (const c of cells) {
      if (c.row !== 0 && c !== cells[0]) continue;
      const m = utc(c.date).getUTCMonth();
      if (m !== last) {
        if (!months.length || c.col - months[months.length - 1].col >= 3) months.push({ col: c.col, label: MONTHS[m] });
        last = m;
      }
    }
    return { cells, cols, months, stats: streaks(days) };
  }, [data, keep]);

  if (!model) return null;
  const left = keep ? 0 : 26;
  const top = 16;
  const w = left + model.cols * (CELL + GAP);
  const h = top + 7 * (CELL + GAP);
  const fmt = (date) => utc(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const s = model.stats;

  return (
    <figure className={keep ? `${g.cal} ${g.calMini}` : g.cal}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img"
        aria-label={`${(data.total ?? 0).toLocaleString()} contributions in the last year`}>
        {model.months.map((m) => (
          <text key={`${m.col}-${m.label}`} x={left + m.col * (CELL + GAP)} y={10} className={g.calText}>{m.label}</text>
        ))}
        {!keep && ['Mon', 'Wed', 'Fri'].map((d, i) => (
          <text key={d} x={0} y={top + (1 + i * 2) * (CELL + GAP) + CELL - 2} className={g.calText}>{d}</text>
        ))}
        {model.cells.map((c) => (
          <rect key={c.date} x={left + c.col * (CELL + GAP)} y={top + c.row * (CELL + GAP)} width={CELL} height={CELL} rx={2.5}
            className={g[`lv${c.level}`]}>
            <title>{c.count ? `${c.count} contribution${c.count === 1 ? '' : 's'} on ${fmt(c.date)}` : `Nothing on ${fmt(c.date)}`}</title>
          </rect>
        ))}
      </svg>
      {showStats && (
        <figcaption className={g.calStats}>
          <span><b>{(data.total ?? 0).toLocaleString()}</b> contributions in the last year{data.private ? ', private work included' : ''}</span>
          <span><b>{s.current}</b> day{s.current === 1 ? '' : 's'} running</span>
          <span><b>{s.longest}</b> longest run</span>
          {s.best && <span><b>{s.best.count}</b> on {fmt(s.best.date)}, the busiest day</span>}
          <span><b>{s.active}</b> active days</span>
        </figcaption>
      )}
    </figure>
  );
}
