// The finder's advanced drawer: every media filter AniList's search accepts —
// format, airing status, season, a year range, a score floor, episode count and
// length, country, source material, the services it streams on, and whether it's
// on your list. All state lives in the URL (see useParamState), so back restores
// it and a link reproduces it.
//
// Number fields commit after a pause, not per keystroke: every commit is an
// AniList request, and the budget is 30 a minute.

import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import { useDebounced } from '../layout/Section.jsx';
import {
  COUNTRY_LABEL, EMPTY_SET, FORMAT_LABEL, MEDIA_STATUS, SET_PARAM, SOURCE_LABEL, titleCase, toggleInSet,
  useParamState,
} from './shared.jsx';
import f from './filters.module.css';

const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'];
const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'HIATUS', 'CANCELLED'];
const SOURCES = ['ORIGINAL', 'MANGA', 'LIGHT_NOVEL', 'WEB_NOVEL', 'NOVEL', 'VISUAL_NOVEL', 'VIDEO_GAME', 'GAME',
  'COMIC', 'MULTIMEDIA_PROJECT', 'OTHER'];
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const LENGTH_PRESETS = [
  ['Shorts', '', '10'],
  ['Standard', '20', '30'],
  ['Long', '31', ''],
];

/** Every advanced filter, read from (and written to) the URL. */
export function useAdvancedFilters() {
  const [fmt, setFmt] = useParamState('fmt', EMPTY_SET, SET_PARAM);
  const [st, setSt] = useParamState('st', EMPTY_SET, SET_PARAM);
  const [src, setSrc] = useParamState('src', EMPTY_SET, SET_PARAM);
  const [svc, setSvc] = useParamState('svc', EMPTY_SET, SET_PARAM);
  const [season, setSeason] = useParamState('fseason', '');
  const [year, setYear] = useParamState('fyear', '');
  const [yf, setYf] = useParamState('yf', '');
  const [yt, setYt] = useParamState('yt', '');
  const [smin, setSmin] = useParamState('smin', '');
  const [emin, setEmin] = useParamState('emin', '');
  const [emax, setEmax] = useParamState('emax', '');
  const [dmin, setDmin] = useParamState('dmin', '');
  const [dmax, setDmax] = useParamState('dmax', '');
  const [country, setCountry] = useParamState('country', '');
  const [onlist, setOnlist] = useParamState('onlist', '');

  const v = { fmt, st, src, svc, season, year, yf, yt, smin, emin, emax, dmin, dmax, country, onlist };
  const set = {
    fmt: setFmt, st: setSt, src: setSrc, svc: setSvc, season: setSeason, year: setYear, yf: setYf,
    yt: setYt, smin: setSmin, emin: setEmin, emax: setEmax, dmin: setDmin, dmax: setDmax,
    country: setCountry, onlist: setOnlist,
  };
  const sets = [fmt, st, src, svc];
  const scalars = [season, year, yf, yt, smin, emin, emax, dmin, dmax, country, onlist];
  const count = sets.reduce((n, x) => n + x.size, 0) + scalars.filter(Boolean).length;

  const csv = (x) => encodeURIComponent([...x].sort().join(','));
  const q = [
    fmt.size && `formats=${csv(fmt)}`, st.size && `statuses=${csv(st)}`, src.size && `sources=${csv(src)}`,
    svc.size && `services=${csv(svc)}`, season && `season=${season}`, year && `year=${year}`,
    yf && `year_from=${yf}`, yt && `year_to=${yt}`, smin && `score_min=${smin}`,
    emin && `episodes_min=${emin}`, emax && `episodes_max=${emax}`, dmin && `duration_min=${dmin}`,
    dmax && `duration_max=${dmax}`, country && `country=${country}`, onlist && `on_list=${onlist}`,
  ].filter(Boolean).join('&');

  const clear = () => {
    for (const k of ['fmt', 'st', 'src', 'svc']) set[k](new Set());
    for (const k of ['season', 'year', 'yf', 'yt', 'smin', 'emin', 'emax', 'dmin', 'dmax', 'country', 'onlist']) set[k]('');
  };

  return { v, set, count, query: q, clear };
}

/** The applied advanced filters as removable pills (for the "Filtering by" bar). */
export function advancedPills(af, services = []) {
  const { v, set } = af;
  const pills = [];
  const drop = (key, item) => () => set[key]((prev) => { const n = new Set(prev); n.delete(item); return n; });
  for (const x of v.fmt) pills.push({ key: `f-${x}`, label: FORMAT_LABEL[x] || x, remove: drop('fmt', x) });
  for (const x of v.st) pills.push({ key: `s-${x}`, label: MEDIA_STATUS[x] || x, remove: drop('st', x) });
  for (const x of v.src) pills.push({ key: `o-${x}`, label: `from ${SOURCE_LABEL[x] || x}`, remove: drop('src', x) });
  if (v.svc.size) {
    const names = services.filter((s) => s.ids.some((id) => v.svc.has(String(id)))).map((s) => s.site);
    pills.push({ key: 'svc', label: `on ${names.length ? names.join(' / ') : `${v.svc.size} services`}`, remove: () => set.svc(new Set()) });
  }
  if (v.season || v.year) {
    pills.push({ key: 'season', label: [v.season && titleCase(v.season), v.year].filter(Boolean).join(' '), remove: () => { set.season(''); set.year(''); } });
  }
  if (v.yf || v.yt) pills.push({ key: 'yr', label: `${v.yf || '…'}–${v.yt || 'now'}`, remove: () => { set.yf(''); set.yt(''); } });
  if (v.smin) pills.push({ key: 'smin', label: `score ≥ ${v.smin}%`, remove: () => set.smin('') });
  if (v.emin || v.emax) {
    pills.push({ key: 'eps', label: v.emin && v.emax ? `${v.emin}–${v.emax} eps` : v.emin ? `≥ ${v.emin} eps` : `≤ ${v.emax} eps`, remove: () => { set.emin(''); set.emax(''); } });
  }
  if (v.dmin || v.dmax) {
    pills.push({ key: 'dur', label: v.dmin && v.dmax ? `${v.dmin}–${v.dmax} min eps` : v.dmin ? `≥ ${v.dmin} min eps` : `≤ ${v.dmax} min eps`, remove: () => { set.dmin(''); set.dmax(''); } });
  }
  if (v.country) pills.push({ key: 'c', label: COUNTRY_LABEL[v.country] || v.country, remove: () => set.country('') });
  if (v.onlist) pills.push({ key: 'l', label: v.onlist === '1' ? 'only my list' : 'not on my list', remove: () => set.onlist('') });
  return pills;
}

/** A number box that owns its keystrokes and publishes the settled value. */
function NumField({ value, onCommit, placeholder, min, max, label, width = '5.5rem' }) {
  const [local, setLocal] = useState(value || '');
  const settled = useDebounced(local, 700);
  useEffect(() => { setLocal(value || ''); }, [value]);
  useEffect(() => {
    if (settled !== (value || '')) onCommit(settled);
  }, [settled]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="number"
      inputMode="numeric"
      className={f.num}
      style={{ width }}
      value={local}
      min={min}
      max={max}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setLocal(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit(local); }}
    />
  );
}

function Chips({ options, selected, onToggle, label = (x) => x }) {
  return (
    <div className={f.chips}>
      {options.map((o) => {
        const on = selected.has(o);
        return (
          <button key={o} type="button" className={on ? f.chipOn : f.chip} onClick={() => onToggle(o)} aria-pressed={on}>
            <span className={f.box}>{on && <Check size={10} />}</span>{label(o)}
          </button>
        );
      })}
    </div>
  );
}

function Drawer({ title, children, wide }) {
  return (
    <section className={`${f.drawer} ${wide ? f.wide : ''}`}>
      <h4 className={f.drawerTitle}>{title}</h4>
      {children}
    </section>
  );
}

export function AdvancedFilters({ af, services = [] }) {
  const { v, set } = af;
  const [score, setScore] = useState(v.smin || 0);
  const settledScore = useDebounced(score, 600);
  useEffect(() => { setScore(v.smin || 0); }, [v.smin]);
  useEffect(() => {
    const next = Number(settledScore) ? String(settledScore) : '';
    if (next !== (v.smin || '')) set.smin(next);
  }, [settledScore]); // eslint-disable-line react-hooks/exhaustive-deps
  const thisYear = new Date().getFullYear();

  const svcOn = (s) => s.ids.every((id) => v.svc.has(String(id)));
  const toggleSvc = (s) => set.svc((prev) => {
    const n = new Set(prev);
    const on = s.ids.every((id) => n.has(String(id)));
    for (const id of s.ids) (on ? n.delete(String(id)) : n.add(String(id)));
    return n;
  });

  return (
    <div className={f.panel}>
      <Drawer title="Format">
        <Chips options={FORMATS} selected={v.fmt} onToggle={toggleInSet(set.fmt)} label={(x) => FORMAT_LABEL[x]} />
      </Drawer>
      <Drawer title="Airing status">
        <Chips options={STATUSES} selected={v.st} onToggle={toggleInSet(set.st)} label={(x) => MEDIA_STATUS[x]} />
      </Drawer>

      <Drawer title="Season">
        <div className={f.inline}>
          <select className={f.select} value={v.season} onChange={(e) => set.season(e.target.value)} aria-label="Season">
            <option value="">Any season</option>
            {SEASONS.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
          </select>
          <NumField value={v.year} onCommit={set.year} placeholder="year" min={1940} max={thisYear + 3} label="Season year" />
        </div>
      </Drawer>
      <Drawer title="First aired between">
        <div className={f.inline}>
          <NumField value={v.yf} onCommit={set.yf} placeholder="from" min={1940} max={thisYear + 3} label="From year" />
          <span className={f.dash}>–</span>
          <NumField value={v.yt} onCommit={set.yt} placeholder="to" min={1940} max={thisYear + 3} label="To year" />
        </div>
      </Drawer>

      <Drawer title={`AniList score ≥ ${score ? `${score}%` : 'any'}`}>
        <input
          type="range"
          min="0"
          max="95"
          step="5"
          value={score}
          className={f.range}
          style={{ '--pct': `${(score / 95) * 100}%` }}
          onChange={(e) => setScore(Number(e.target.value))}
          aria-label="Minimum AniList score"
        />
      </Drawer>
      <Drawer title="Episodes">
        <div className={f.inline}>
          <NumField value={v.emin} onCommit={set.emin} placeholder="min" min={1} label="Minimum episodes" />
          <span className={f.dash}>–</span>
          <NumField value={v.emax} onCommit={set.emax} placeholder="max" min={1} label="Maximum episodes" />
        </div>
      </Drawer>
      <Drawer title="Episode length (minutes)">
        <div className={f.inline}>
          {LENGTH_PRESETS.map(([label, lo, hi]) => {
            const on = v.dmin === lo && v.dmax === hi;
            return (
              <button key={label} type="button" className={on ? f.chipOn : f.chip}
                      onClick={() => { set.dmin(on ? '' : lo); set.dmax(on ? '' : hi); }} aria-pressed={on}>
                {label}
              </button>
            );
          })}
          <NumField value={v.dmin} onCommit={set.dmin} placeholder="min" min={1} label="Minimum minutes" width="4.5rem" />
          <NumField value={v.dmax} onCommit={set.dmax} placeholder="max" min={1} label="Maximum minutes" width="4.5rem" />
        </div>
      </Drawer>
      <Drawer title="Made in">
        <div className={f.chips}>
          {['', ...Object.keys(COUNTRY_LABEL)].map((c) => (
            <button key={c || 'any'} type="button" className={v.country === c ? f.chipOn : f.chip} onClick={() => set.country(c)} aria-pressed={v.country === c}>
              {c ? COUNTRY_LABEL[c] : 'Anywhere'}
            </button>
          ))}
        </div>
      </Drawer>

      <Drawer title="Adapted from" wide>
        <Chips options={SOURCES} selected={v.src} onToggle={toggleInSet(set.src)} label={(x) => SOURCE_LABEL[x]} />
      </Drawer>

      {services.length > 0 && (
        <Drawer title="Streams on" wide>
          <div className={f.chips}>
            {services.map((s) => {
              const on = svcOn(s);
              return (
                <button key={s.site} type="button" className={on ? f.chipOn : f.chip} onClick={() => toggleSvc(s)}
                        aria-pressed={on} style={s.color ? { '--svc-c': s.color } : undefined}
                        title={s.languages.length ? `Regions: ${s.languages.join(', ')}` : undefined}>
                  {s.icon ? <img className={f.svcIcon} src={s.icon} alt="" /> : <span className={f.box}>{on && <Check size={10} />}</span>}
                  {s.site}
                </button>
              );
            })}
          </div>
        </Drawer>
      )}

      <Drawer title="Your list" wide>
        <div className={f.chips}>
          {[['', 'Doesn’t matter'], ['1', 'Only titles on my list'], ['0', 'Hide titles on my list']].map(([k, label]) => (
            <button key={k || 'any'} type="button" className={v.onlist === k ? f.chipOn : f.chip} onClick={() => set.onlist(k)} aria-pressed={v.onlist === k}>
              {label}
            </button>
          ))}
          {af.count > 0 && (
            <button type="button" className={f.reset} onClick={af.clear}><X size={12} /> reset these filters</button>
          )}
        </div>
      </Drawer>
    </div>
  );
}
