// People of the medium: characters, the staff who voice and make them, the
// studios, and AniList's users — the cards Browse's "search in" modes and the
// Community hall of fame / birthday board share.
//
// Each kind gets its own shape, because they aren't the same thing: a character
// is a portrait with the show it's from, a person is a headshot with their trade,
// a studio is a nameplate over a strip of its best-known posters, a user is a
// calling card that opens their profile.

import { Link } from 'react-router-dom';
import { Cake, Heart, Tv } from 'lucide-react';

import { compact } from '../../lib/format.js';
import { accentOf, PersonAvatar } from './Person.jsx';
import p from './people.module.css';

export function CharacterCard({ c, rank, index = 0, badge }) {
  return (
    <Link to={`/anime/character/${c.id}`} className={p.portrait} style={{ '--i': Math.min(index, 14) }}>
      <span className={p.frame}>
        {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className={p.blank}>{(c.name || '?')[0]}</span>}
        {rank != null && <span className={p.rank}>{rank}</span>}
        {badge && <span className={p.badge}>{badge}</span>}
      </span>
      <span className={p.name}>{c.name}</span>
      {c.native && <span className={p.native} lang="ja">{c.native}</span>}
      <span className={p.meta}>
        {c.from?.title && <span className={p.from}>{c.from.title}</span>}
        {c.favourites > 0 && <span className={p.hearts}><Heart size={9} /> {compact(c.favourites)}</span>}
      </span>
    </Link>
  );
}

export function StaffCard({ s, rank, index = 0, badge }) {
  return (
    <Link to={`/anime/voice/${s.id}`} className={`${p.portrait} ${p.staff}`} style={{ '--i': Math.min(index, 14) }}>
      <span className={p.frame}>
        {s.image ? <img src={s.image} alt="" loading="lazy" /> : <span className={p.blank}>{(s.name || '?')[0]}</span>}
        {rank != null && <span className={p.rank}>{rank}</span>}
        {badge && <span className={p.badge}>{badge}</span>}
      </span>
      <span className={p.name}>{s.name}</span>
      {s.native && <span className={p.native} lang="ja">{s.native}</span>}
      <span className={p.meta}>
        <span className={p.from}>{(s.occupations || []).slice(0, 2).join(' · ') || s.language || ''}</span>
        {s.favourites > 0 && <span className={p.hearts}><Heart size={9} /> {compact(s.favourites)}</span>}
      </span>
    </Link>
  );
}

export function StudioTile({ st, rank, index = 0 }) {
  return (
    <Link to={`/anime/studio/${st.id}`} className={p.studio} style={{ '--i': Math.min(index, 14) }}>
      <span className={p.strip}>
        {st.works?.length ? st.works.slice(0, 4).map((w) => (
          <img key={w.id} src={w.cover} alt="" loading="lazy" />
        )) : <span className={p.stripBlank}><Tv size={20} /></span>}
      </span>
      <span className={p.plate}>
        {rank != null && <span className={p.plateRank}>{rank}</span>}
        <span className={p.plateName}>{st.name}</span>
        <span className={p.plateMeta}>
          {st.animation ? 'animation studio' : 'producer'}
          {st.favourites > 0 && <> · <Heart size={9} /> {compact(st.favourites)}</>}
        </span>
      </span>
    </Link>
  );
}

export function UserCard({ u }) {
  return (
    <Link to={`/anime/user/${encodeURIComponent(u.name)}`} className={p.user}
          style={{ ...(u.banner ? { '--banner': `url(${u.banner})` } : {}), '--accent': accentOf(u.color) }}>
      <PersonAvatar user={u} size="md" />
      <span className={p.userName}>{u.name}</span>
      {u.donator > 0 && <span className={p.supporter}>supporter</span>}
    </Link>
  );
}

/** The right card for a kind of result, in the right grid. */
export function PeopleGrid({ kind, items, ranked = false }) {
  if (kind === 'studios') {
    return (
      <div className={p.studioGrid}>
        {items.map((st, i) => <StudioTile key={st.id} st={st} index={i} rank={ranked ? i + 1 : null} />)}
      </div>
    );
  }
  if (kind === 'users') {
    return <div className={p.userGrid}>{items.map((u) => <UserCard key={u.id} u={u} />)}</div>;
  }
  const Card = kind === 'staff' ? StaffCard : CharacterCard;
  return (
    <div className={p.grid}>
      {items.map((x, i) => (
        <Card key={x.id} {...(kind === 'staff' ? { s: x } : { c: x })} index={i} rank={ranked ? i + 1 : null} />
      ))}
    </div>
  );
}

/** Today's birthdays — characters and the people behind them, as a pinboard. */
export function BirthdayBoard({ data }) {
  if (!data) return null;
  const date = new Date(`${data.date}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' });
  if (!data.characters.length && !data.staff.length) {
    return <p className={p.muted}>No birthdays on AniList for {date}.</p>;
  }
  return (
    <div className={p.board}>
      <p className={p.boardHead}><Cake size={16} /> Born on {date}</p>
      {data.characters.length > 0 && (
        <>
          <span className={p.boardSub}>Characters</span>
          <div className={p.grid}>
            {data.characters.map((c, i) => <CharacterCard key={c.id} c={c} index={i} badge={<Cake size={11} />} />)}
          </div>
        </>
      )}
      {data.staff.length > 0 && (
        <>
          <span className={p.boardSub}>Voice actors & staff</span>
          <div className={p.grid}>
            {data.staff.map((s, i) => (
              <StaffCard key={s.id} s={s} index={i} badge={s.age ? `${s.age}` : <Cake size={11} />} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
