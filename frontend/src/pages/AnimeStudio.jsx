// A studio's page — the reel.
//
// The masthead is the studio's name set big between two strips of film
// sprockets; below it, the filmography runs down a year rail like a reel being
// unspooled — newest first, or re-cut by popularity or score. A studio is also
// credited as *producer* on shows it didn't animate; "main productions only"
// keeps the ones it actually made.

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Film } from 'lucide-react';

import { useApi } from '../api/client.js';
import { ErrorBox, Receiving } from '../components/layout/Section.jsx';
import { SegmentedControl } from '../components/ui/index.jsx';
import {
  AnimeCard, FavToggle, InfiniteSentinel, useInfinite, useParamState,
} from '../components/anime/shared.jsx';
import s from './studio.module.css';

export default function AnimeStudio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sort, setSort] = useParamState('sort', 'newest');
  const [main, setMain] = useParamState('main', '1');
  const me = useApi('/anime/me');
  const feed = useInfinite(`${id}|${sort}|${main}`, (p) => `/anime/studio/${id}?page=${p}&sort=${sort}${main === '1' ? '&main=1' : ''}`);
  const st = feed.extra?.studio;
  const items = feed.items || [];

  const byYear = useMemo(() => {
    if (sort !== 'newest') return null;
    const groups = [];
    for (const m of items) {
      const y = m.year || m.start_date?.slice(0, 4) || 'TBA';
      const last = groups[groups.length - 1];
      if (last && last.year === String(y)) last.items.push(m);
      else groups.push({ year: String(y), items: [m] });
    }
    return groups;
  }, [items, sort]);

  const scored = items.filter((m) => m.score);
  const avg = scored.length ? Math.round(scored.reduce((n, m) => n + m.score, 0) / scored.length) : null;
  const genres = {};
  for (const m of items) for (const g of m.genres || []) genres[g] = (genres[g] || 0) + 1;
  // Genres and the average come from the pages loaded so far — labelled as such,
  // since a studio's full history is hundreds of titles away.
  const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);

  return (
    <>
      <button onClick={() => navigate(-1)} className={s.back}>
        <ArrowLeft size={13} /> back
      </button>
      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && !st && <Receiving label="threading the reel" />}
      {st && (
        <article className={s.page}>
          <header className={s.mast}>
            <span className={s.sprockets} aria-hidden="true" />
            <div className={s.mastInner}>
              <span className={s.kicker}><Film size={12} /> {st.animation ? 'Animation studio' : 'Studio · producer'}</span>
              <h1 className={s.name}>{st.name}</h1>
              <div className={s.facts}>
                {st.total != null && <span><b>{st.total.toLocaleString()}</b> {main === '1' ? 'productions' : 'credits'}</span>}
                {avg != null && <span>average <b>{avg}%</b> <em>(of those shown)</em></span>}
                {topGenres.length > 0 && <span>known for <b>{topGenres.join(', ')}</b></span>}
              </div>
              <div className={s.actions}>
                {me.data && <FavToggle kind="studio" id={st.id} initial={st.is_favourite} count={st.favourites} />}
                {st.site_url && <a className={s.source} href={st.site_url} target="_blank" rel="noreferrer">AniList <ExternalLink size={11} /></a>}
              </div>
            </div>
            <span className={s.sprockets} aria-hidden="true" />
          </header>

          <div className={s.controls}>
            <SegmentedControl
              options={[{ value: 'newest', label: 'By year' }, { value: 'popular', label: 'Best known' }, { value: 'score', label: 'Top rated' }]}
              value={sort}
              onChange={setSort}
            />
            <label className={s.toggle}>
              <input type="checkbox" checked={main === '1'} onChange={(e) => setMain(e.target.checked ? '1' : '0')} />
              main productions only
            </label>
          </div>

          {byYear ? (
            <div className={s.reel}>
              {byYear.map((g) => (
                <section key={g.year} className={s.yearRow}>
                  <h2 className={s.year}>{g.year}</h2>
                  <div className={s.frames}>
                    {g.items.map((m) => (
                      <div key={m.id} className={s.frame}>
                        <AnimeCard media={m} scoreFormat={me.data?.score_format} corner={m.main === false ? 'producer' : null} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className={s.grid}>
              {items.map((m) => (
                <AnimeCard key={m.id} media={m} scoreFormat={me.data?.score_format} corner={m.main === false ? 'producer' : null} />
              ))}
            </div>
          )}
          {items.length > 0 && (
            <InfiniteSentinel onReach={feed.loadMore} active={feed.hasMore && !feed.error} count={items.length} />
          )}
          {feed.loadingMore && <p className={s.more}>unspooling more…</p>}
          {!feed.hasMore && items.length > 0 && <p className={s.more}>· end of reel ·</p>}
        </article>
      )}
    </>
  );
}
