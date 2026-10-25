// Search's anime results (the Anime room's part of the phone app, in its split
// APK): the poster wall for "Anime", and the strip under "Everything".

import { useEffect, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';

import { useApi } from '@pc/api/client.js';

import { Empty, ErrorNote, Sentinel, Skeleton } from '../shell/Shell.jsx';
import { Poster } from './animeKit.jsx';
import r from './search.module.css';

/** Paged AniList search, as a poster wall. */
export default function AnimeResults({ q }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const res = useApi(`/anime/search?q=${encodeURIComponent(q)}&page=${page}`, !!q);
  useEffect(() => { setPage(1); setItems([]); }, [q]);
  useEffect(() => {
    if (!res.data) return;
    setItems((prev) => (page === 1 ? res.data.items : [...prev, ...res.data.items.filter((x) => !prev.some((y) => y.id === x.id))]));
  }, [res.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {res.error && <ErrorNote message={res.error} />}
      {res.loading && !items.length && <Skeleton kind="posters" n={9} />}
      {res.data && !items.length && <Empty Icon={SearchIcon} title="No anime" text={`Nothing on AniList matches “${q}”.`} />}
      <div className={r.wall}>{items.map((m) => <Poster key={m.id} media={m} />)}</div>
      <Sentinel onReach={() => setPage((p) => p + 1)} active={!!res.data?.has_next && !res.loading} />
    </>
  );
}

/** The first titles found, in a row. */
export function AnimeStrip({ items }) {
  return <div className={r.strip}>{items.slice(0, 10).map((m) => <Poster key={m.id} media={m} />)}</div>;
}
