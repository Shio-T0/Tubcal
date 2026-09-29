// Small, quiet charts for the Anime room — plain HTML/SVG, no chart library.
//
// Every chart here plots ONE series in the room's accent (bars, columns, lines),
// or two series where one is highlighted and the other is neutral ink with a
// hollow marker (the dumbbell) — so identity is never carried by hue alone, and
// all seven skins restyle them through tokens. Marks are thin with rounded data
// ends; values sit at the tip of the extreme mark only; every mark is a hover AND
// focus target with a text tooltip; and each chart can be read as a table.

import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import c from './charts.module.css';

const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());

/** Every chart's accessible twin: the same numbers as a table, one click away. */
export function ChartTable({ columns, rows, caption }) {
  if (!rows?.length) return null;
  return (
    <details className={c.tableWrap}>
      <summary className={c.tableToggle}>view as table</summary>
      <table className={c.table}>
        {caption && <caption className={c.srOnly}>{caption}</caption>}
        <thead>
          <tr>{columns.map((col) => <th key={col.key} scope="col">{col.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key ?? i}>
              {columns.map((col) => <td key={col.key}>{col.render ? col.render(r) : r[col.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** A labelled number: the ledger's unit of account. Proportional figures, sans. */
export function StatTile({ label, value, hint, accent = false }) {
  return (
    <div className={`${c.tile} ${accent ? c.tileAccent : ''}`}>
      <span className={c.tileLabel}>{label}</span>
      <span className={c.tileValue}>{value ?? '—'}</span>
      {hint && <span className={c.tileHint}>{hint}</span>}
    </div>
  );
}

/** Ranked horizontal bars — genres, studios, statuses. Each row is a table row in
 *  all but name: its label, a bar scaled to the longest, and its value at the tip.
 *  `tip(row)` adds the detail the bar can't carry (mean score, hours). */
export function BarList({ rows, value = (r) => r.value, label = (r) => r.label, format = fmtNum,
                          tip, href, limit, emptyText = 'Nothing to chart yet.' }) {
  const [all, setAll] = useState(false);
  if (!rows?.length) return <p className={c.empty}>{emptyText}</p>;
  const max = Math.max(...rows.map(value), 1);
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return (
    <div className={c.barList}>
      {shown.map((r, i) => {
        const v = value(r);
        const to = href?.(r);
        const name = label(r);
        const inner = (
          <>
            <span className={c.barLabel} title={name}>{name}</span>
            <span className={c.barTrack}>
              <span className={c.bar} style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, '--i': Math.min(i, 14) }} />
            </span>
            <span className={c.barValue}>{format(v, r)}</span>
          </>
        );
        const props = {
          className: c.barRow,
          'data-tip': tip ? tip(r) : undefined,
          tabIndex: to ? undefined : 0,
          'aria-label': `${name}: ${format(v, r)}${tip ? `. ${tip(r)}` : ''}`,
        };
        return to
          ? <Link key={r.key ?? name} to={to} {...props}>{inner}</Link>
          : <div key={r.key ?? name} {...props}>{inner}</div>;
      })}
      {limit && rows.length > limit && (
        <button type="button" className={c.more} onClick={() => setAll((v) => !v)}>
          {all ? 'fewer' : `all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** Columns over an ordered axis — score buckets, years, months. Only the tallest
 *  column is labelled on its cap; the rest carry their value in a tooltip. */
export function Columns({ data, height = 132, format = fmtNum, tip, xLabelEvery, ariaLabel }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.value), 0);
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const every = xLabelEvery || (data.length > 16 ? Math.ceil(data.length / 10) : 1);
  return (
    <div className={c.columns} role="img" aria-label={ariaLabel} style={{ '--plot-h': `${height}px` }}>
      <div className={c.colPlot}>
        {data.map((d, i) => {
          const h = max ? (d.value / max) * 100 : 0;
          return (
            <div
              key={d.key ?? d.label}
              className={c.colSlot}
              tabIndex={0}
              data-tip={tip ? tip(d) : `${d.label}: ${format(d.value)}`}
              aria-label={`${d.label}: ${format(d.value)}`}
            >
              {i === peak && max > 0 && <span className={c.colCap} style={{ bottom: `${h}%` }}>{format(d.value)}</span>}
              <span className={c.col} style={{ height: `${d.value ? Math.max(h, 1.5) : 0}%`, '--i': Math.min(i, 20) }} />
            </div>
          );
        })}
      </div>
      <div className={c.colAxis}>
        {data.map((d, i) => (
          <span key={d.key ?? d.label} className={c.colTick}>{i % every === 0 ? d.label : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** One measure over time as a 2px line with a faint wash, a crosshair that snaps
 *  to the nearest day, and the latest value labelled at the line's end. Two
 *  measures get two of these side by side — never one chart with two scales. */
export function LineChart({ points, title, format = fmtNum, xFormat = (x) => x, height = 110 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 600;
  const H = height;
  const pad = { l: 6, r: 44, t: 12, b: 16 };
  const geo = useMemo(() => {
    const ys = points.map((p) => p.y);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (lo === hi) { lo -= 1; hi += 1; }
    const x = (i) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)},${H - pad.b}L${x(0).toFixed(1)},${H - pad.b}Z`;
    return { x, y, line, area, lo, hi };
  }, [points, H]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!points?.length) return null;
  const last = points.length - 1;
  const onMove = (e) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const fx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((fx - pad.l) / (W - pad.l - pad.r)) * last);
    setHover(Math.max(0, Math.min(last, i)));
  };
  const h = hover ?? null;
  return (
    <figure className={c.line}>
      {title && <figcaption className={c.lineTitle}>{title}</figcaption>}
      <div className={c.lineWrap}>
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={c.lineSvg}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? last) - 1));
            if (e.key === 'ArrowRight') setHover((v) => Math.min(last, (v ?? 0) + 1));
          }}
          onBlur={() => setHover(null)}
          role="img"
          aria-label={`${title || 'Trend'}: from ${format(points[0].y)} to ${format(points[last].y)}`}
        >
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className={c.axis} />
          <path d={geo.area} className={c.area} />
          <path d={geo.line} className={c.stroke} vectorEffect="non-scaling-stroke" />
          {h != null && (
            <line x1={geo.x(h)} x2={geo.x(h)} y1={pad.t - 6} y2={H - pad.b} className={c.cross} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* Dots and labels live in HTML so the stretched SVG can't squash them. */}
        <span className={c.dot} style={{ left: `${(geo.x(last) / W) * 100}%`, top: `${(geo.y(points[last].y) / H) * 100}%` }} />
        <span className={c.endLabel} style={{ top: `${(geo.y(points[last].y) / H) * 100}%` }}>{format(points[last].y)}</span>
        {h != null && (
          <>
            <span className={c.dot} style={{ left: `${(geo.x(h) / W) * 100}%`, top: `${(geo.y(points[h].y) / H) * 100}%` }} />
            <span
              className={c.lineTip}
              style={{ left: `${Math.min(80, Math.max(12, (geo.x(h) / W) * 100))}%` }}
            >
              <strong>{format(points[h].y)}</strong> {xFormat(points[h].x)}
            </span>
          </>
        )}
      </div>
      <div className={c.lineAxis}>
        <span>{xFormat(points[0].x)}</span>
        <span>{xFormat(points[last].x)}</span>
      </div>
    </figure>
  );
}

/** Two values per row on a shared 0–100 track: yours (filled, in the accent) and
 *  the other side's (a hollow ring in neutral ink), joined by a hairline so the gap
 *  itself is what you read. Used for "you vs the crowd" and "you vs a friend". */
export function Dumbbell({ rows, aName = 'You', bName = 'Crowd', max = 100 }) {
  if (!rows?.length) return null;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className={c.dumbbell}>
      <div className={c.legend} aria-hidden="true">
        <span><i className={c.keyA} /> {aName}</span>
        <span><i className={c.keyB} /> {bName}</span>
      </div>
      {rows.map((r) => {
        const lo = Math.min(r.a, r.b);
        const hi = Math.max(r.a, r.b);
        const diff = r.a - r.b;
        const label = `${r.label}: ${aName.toLowerCase()} ${r.a}, ${bName.toLowerCase()} ${r.b}`;
        const Row = r.href ? Link : 'div';
        return (
          <Row key={r.key} {...(r.href ? { to: r.href } : { tabIndex: 0 })} className={c.dbRow} aria-label={label}
               data-tip={`${aName} ${r.a} · ${bName} ${r.b} (${diff > 0 ? '+' : ''}${diff})`}>
            <span className={c.dbLabel}>
              {r.cover && <img src={r.cover} alt="" loading="lazy" />}
              <span>{r.label}</span>
            </span>
            <span className={c.dbTrack}>
              <span className={c.dbGap} style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
              <span className={c.dbB} style={{ left: pct(r.b) }} />
              <span className={c.dbA} style={{ left: pct(r.a) }} />
            </span>
            <span className={c.dbValue}>
              <strong>{r.a}</strong> · {r.b}
              <em className={diff > 0 ? c.dbUp : c.dbDown}>{diff > 0 ? `+${diff}` : diff}</em>
            </span>
          </Row>
        );
      })}
    </div>
  );
}
