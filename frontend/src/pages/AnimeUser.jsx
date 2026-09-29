// A person's page — /anime/user/:name. Anyone on AniList, you included.
//
// The hero is theirs: their banner, their face ringed in their own profile
// colour (the whole page takes that colour as its accent), how long they've been
// around, what they used to be called, and what you are to each other. Below it,
// four rooms: an overview (their bio, rendered as they wrote it, next to their
// numbers and favourites), their activity, and who they follow / who follows them.
// Writing on their wall opens the same desk as everywhere else, previewed live.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CalendarDays, ExternalLink, Lock, MessageSquare, Scale, Settings2, Sparkles, UserRound,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { compact } from '../lib/format.js';
import { useToast } from '../state.jsx';
import { ErrorBox, Receiving } from '../components/layout/Section.jsx';
import { ActivityFeed } from '../components/anime/Activity.jsx';
import { MarkdownComposer } from '../components/anime/Composer.jsx';
import { accentOf, asPerson, FollowButton, forgetCard, PersonAvatar } from '../components/anime/Person.jsx';
import { ProfileStudio } from '../components/anime/Profile.jsx';
import { AniHtml } from '../components/anime/RichText.jsx';
import { FollowGrid } from '../components/anime/SocialDesk.jsx';
import { formatLabel, STATUS_LABEL, useParamState } from '../components/anime/shared.jsx';
import u from './user.module.css';

const VIEWS = ['overview', 'activity', 'following', 'followers'];
const STATUS_ORDER = ['COMPLETED', 'CURRENT', 'REPEATING', 'PAUSED', 'DROPPED', 'PLANNING'];

const joined = (s) => (s ? new Date(s * 1000).toLocaleDateString([], { month: 'long', year: 'numeric' }) : null);

function Numbers({ st }) {
  const days = Math.round((st.minutes / 1440) * 10) / 10;
  return (
    <dl className={u.numbers}>
      <div><dt>anime</dt><dd>{compact(st.count)}</dd></div>
      <div><dt>episodes</dt><dd>{compact(st.episodes)}</dd></div>
      <div><dt>days watched</dt><dd>{days}</dd></div>
      <div>
        <dt>mean score</dt>
        <dd>{st.mean_score ? Math.round(st.mean_score) : '—'}{st.std_dev ? <small> ±{Math.round(st.std_dev)}</small> : null}</dd>
      </div>
    </dl>
  );
}

function StatusBar({ statuses }) {
  const rows = [...(statuses || [])].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (!total) return null;
  return (
    <section className={u.side}>
      <h3 className={u.sideHead}>Their shelves</h3>
      <div className={u.bar} role="img" aria-label={rows.map((r) => `${STATUS_LABEL[r.status]} ${r.count}`).join(', ')}>
        {rows.map((r) => (
          <span key={r.status} className={u[`s_${r.status}`]} style={{ flexGrow: r.count }} title={`${STATUS_LABEL[r.status]} · ${r.count}`} />
        ))}
      </div>
      <ul className={u.legend}>
        {rows.map((r) => (
          <li key={r.status}><i className={u[`s_${r.status}`]} /> {STATUS_LABEL[r.status] || r.status} <b>{r.count}</b></li>
        ))}
      </ul>
    </section>
  );
}

function Genres({ genres }) {
  if (!genres?.length) return null;
  const max = genres[0].count || 1;
  return (
    <section className={u.side}>
      <h3 className={u.sideHead}>Most watched</h3>
      <ul className={u.genres}>
        {genres.map((g) => (
          <li key={g.genre}>
            <Link to={`/anime?tab=browse&g=${encodeURIComponent(g.genre)}`}>{g.genre}</Link>
            <span className={u.track}><span style={{ width: `${Math.max(6, (g.count / max) * 100)}%` }} /></span>
            <b>{g.count}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Formats({ formats }) {
  const rows = [...(formats || [])].sort((a, b) => b.count - a.count).slice(0, 6);
  if (!rows.length) return null;
  return (
    <section className={u.side}>
      <h3 className={u.sideHead}>By format</h3>
      <div className={u.chips}>
        {rows.map((f) => <span key={f.format}>{formatLabel(f.format)} <b>{f.count}</b></span>)}
      </div>
    </section>
  );
}

function About({ html }) {
  const [open, setOpen] = useState(false);
  if (!html) return <p className={u.quiet}>No bio yet.</p>;
  const long = html.length > 1600;
  return (
    <div className={`${u.about} ${long && !open ? u.aboutClamped : ''}`}>
      <AniHtml html={html} />
      {long && (
        <button type="button" className={u.aboutMore} onClick={() => setOpen((o) => !o)}>
          {open ? 'Fold it back' : 'Read the whole bio'}
        </button>
      )}
    </div>
  );
}

function Favourites({ p }) {
  const any = p.favourites?.length || p.favourite_characters?.length || p.favourite_staff?.length || p.favourite_studios?.length;
  if (!any) return null;
  return (
    <section className={u.block}>
      <h2 className={u.blockHead}>Favourites</h2>
      {p.favourites?.length > 0 && (
        <div className={u.posters}>
          {p.favourites.map((f, i) => (
            <Link key={f.id} to={`/anime/${f.id}`} className={u.poster} title={f.title} style={{ '--i': i }}>
              {f.cover ? <img src={f.cover} alt="" loading="lazy" /> : <span />}
              <span className={u.posterTitle}>{f.title}</span>
            </Link>
          ))}
        </div>
      )}
      {(p.favourite_characters?.length > 0 || p.favourite_staff?.length > 0) && (
        <div className={u.faces}>
          {(p.favourite_characters || []).map((c) => (
            <Link key={`c${c.id}`} to={`/anime/character/${c.id}`} className={u.faceCard} title={c.name}>
              {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className={u.faceBlank}>{(c.name || '?')[0]}</span>}
              <span>{c.name}</span>
            </Link>
          ))}
          {(p.favourite_staff || []).map((c) => (
            <Link key={`s${c.id}`} to={`/anime/voice/${c.id}`} className={`${u.faceCard} ${u.faceStaff}`} title={`${c.name} — voice / staff`}>
              {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className={u.faceBlank}>{(c.name || '?')[0]}</span>}
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
      )}
      {p.favourite_studios?.length > 0 && (
        <div className={u.chips}>
          {p.favourite_studios.map((s) => <Link key={s.id} to={`/anime/studio/${s.id}`}>{s.name}</Link>)}
        </div>
      )}
    </section>
  );
}

function MessageDesk({ person, onSent, onCancel }) {
  const toast = useToast();
  const [priv, setPriv] = useState(false);
  const send = async (text) => {
    try {
      await api('/anime/message', { method: 'POST', body: JSON.stringify({ recipient_id: person.id, text, private: priv }) });
      toast(`Message sent to ${person.name}`, 'success');
      onSent?.();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  return (
    <section className={u.messageDesk}>
      <h3 className={u.sideHead}><MessageSquare size={13} /> A message on {person.name}'s profile</h3>
      <MarkdownComposer
        previewAs="message"
        submitLabel="Send"
        placeholder={`Say hello to ${person.name}…`}
        draftKey={`message:${person.id}`}
        autoFocus
        onSubmit={send}
        onCancel={onCancel}
        extra={(
          <label className={u.priv} title="Only you and them will see it">
            <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> <Lock size={11} /> private
          </label>
        )}
      />
    </section>
  );
}

export default function AnimeUser() {
  const { name } = useParams();
  const navigate = useNavigate();
  const prof = useApi(`/anime/user/${encodeURIComponent(name)}`);
  const meRes = useApi('/anime/me');
  const me = asPerson(meRes.data);
  const [rawView, setView] = useParamState('v', 'overview');
  const view = VIEWS.includes(rawView) ? rawView : 'overview';
  const [messaging, setMessaging] = useState(false);
  const [studio, setStudio] = useState(false);
  const p = prof.data;

  if (prof.loading && !p) return <Receiving label={`knocking on ${name}'s door`} />;
  if (prof.error || !p) {
    return (
      <div className={u.missing}>
        <UserRound size={30} />
        <ErrorBox message={prof.error === 'user not found' ? `There's no one called “${name}” on AniList.` : prof.error || 'Could not load this profile.'} />
      </div>
    );
  }

  const self = me && me.id === p.id;
  const accent = accentOf(p.color);
  const mutual = p.is_following && p.is_follower;
  const views = [
    ['overview', 'Overview'],
    ['activity', 'Activity'],
    ['following', `Following${p.following_count != null ? ` · ${compact(p.following_count)}` : ''}`],
    ['followers', `Followers${p.followers_count != null ? ` · ${compact(p.followers_count)}` : ''}`],
  ];

  return (
    <div className={u.page} style={{ '--accent': accent }}>
      <header className={u.hero}>
        <div className={u.banner} style={p.banner ? { backgroundImage: `url(${p.banner})` } : undefined} />
        <div className={u.heroBody}>
          <PersonAvatar user={p} size="xl" className={u.av} />
          <div className={u.who}>
            <h1 className={u.name}>{p.name}</h1>
            <div className={u.badges}>
              {self && <em className={u.bYou}>this is you</em>}
              {!self && mutual && <em className={u.bMutual}>you follow each other</em>}
              {!self && !mutual && p.is_follower && <em className={u.bFollows}>follows you</em>}
              {p.donator > 0 && (
                <em className={u.bDonor} title={`AniList supporter, tier ${p.donator}`}>
                  <Sparkles size={11} /> {p.donator_badge || 'Supporter'}
                </em>
              )}
            </div>
            <p className={u.sub}>
              {p.created_at && <span><CalendarDays size={12} /> on AniList since {joined(p.created_at)}</span>}
              {p.previous_names?.length > 0 && (
                <span title="Previous names">formerly {p.previous_names.slice(-3).join(', ')}</span>
              )}
              {p.site_url && (
                <a href={p.site_url} target="_blank" rel="noreferrer">AniList <ExternalLink size={11} /></a>
              )}
            </p>
          </div>
          <div className={u.actions}>
            {self ? (
              <button type="button" className={u.primary} onClick={() => setStudio(true)}>
                <Settings2 size={14} /> Edit profile &amp; settings
              </button>
            ) : me ? (
              <>
                <FollowButton user={p} onChange={() => { forgetCard(p.name); prof.reload(); }} />
                <button type="button" className={`${u.ghost} ${messaging ? u.ghostOn : ''}`} onClick={() => setMessaging((m) => !m)}>
                  <MessageSquare size={14} /> Message
                </button>
                <button type="button" className={u.ghost} onClick={() => navigate(`/anime?tab=ledger&cmp=${encodeURIComponent(p.name)}`)}>
                  <Scale size={14} /> Compare tastes
                </button>
              </>
            ) : null}
          </div>
        </div>
        <nav className={u.tabs} role="tablist" aria-label={`${p.name}'s profile`}>
          {views.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? u.tabOn : u.tab}
                    onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </nav>
      </header>

      {messaging && !self && (
        <MessageDesk person={p} onCancel={() => setMessaging(false)} onSent={() => { setMessaging(false); setView('activity'); }} />
      )}

      {view === 'overview' && (
        <div className={u.overview}>
          <div className={u.main}>
            <section className={u.block}>
              <h2 className={u.blockHead}>About {self ? 'you' : p.name}</h2>
              <About html={p.about_html} />
            </section>
            <Favourites p={p} />
          </div>
          <aside className={u.rail}>
            <Numbers st={p.stats} />
            <StatusBar statuses={p.stats.statuses} />
            <Genres genres={p.stats.genres} />
            <Formats formats={p.stats.formats} />
          </aside>
        </div>
      )}
      {view === 'activity' && (
        <div className={u.single}><ActivityFeed userId={p.id} showComposer={false} /></div>
      )}
      {(view === 'following' || view === 'followers') && <FollowGrid userId={p.id} which={view} me={me} />}

      {studio && <ProfileStudio onClose={() => { setStudio(false); prof.reload(); }} />}
    </div>
  );
}
