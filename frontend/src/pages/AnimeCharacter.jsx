// A character's page — the trading card.
//
// A fourth texture for the people of the room: the show page is poster art, the
// cast is a theatre programme, a voice actor's is a personnel file, and a
// character gets a collectible card — framed portrait, the vitals printed like
// card stats, the bio on the back, and every appearance with the voice that
// played them there (switchable between the dubs, like the cast sheet).

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Eye, Heart } from 'lucide-react';

import { useApi } from '../api/client.js';
import { ErrorBox, Receiving } from '../components/layout/Section.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { compact } from '../lib/format.js';
import { AniText, FavToggle, fuzzyDateLabel, metaLine } from '../components/anime/shared.jsx';
import s from './character.module.css';

const ROLE = { MAIN: 'Lead', SUPPORTING: 'Supporting', BACKGROUND: 'Background' };

function languagesOf(apps) {
  const n = {};
  for (const a of apps) for (const v of a.voices) if (v.language) n[v.language] = (n[v.language] || 0) + 1;
  return Object.keys(n).sort((a, b) => (a === 'Japanese' ? -1 : b === 'Japanese' ? 1 : n[b] - n[a]));
}

export default function AnimeCharacter() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ch = useApi(`/anime/character/${id}`);
  const me = useApi('/anime/me');
  const d = ch.data;
  const apps = useMemo(() => d?.appearances || [], [d]);
  const langs = useMemo(() => languagesOf(apps), [apps]);
  const [lang, setLang] = useState(null);
  const [showSpoilerNames, setShowSpoilerNames] = useState(false);
  const activeLang = lang || (langs.includes('Japanese') ? 'Japanese' : langs[0]);
  const signature = apps[0]?.media;

  return (
    <>
      <button onClick={() => navigate(-1)} className={s.back}>
        <ArrowLeft size={13} /> back
      </button>
      {ch.error && <ErrorBox message={ch.error} />}
      {ch.loading && !d && <Receiving label="drawing the card" />}
      {d && (
        <article className={s.page} style={{ '--card-c': signature?.color || 'var(--c-anime)' }}>
          {signature?.banner && <div className={s.backdrop} style={{ backgroundImage: `url(${signature.banner})` }} aria-hidden="true" />}
          <div className={s.top}>
            <div className={s.card}>
              <div className={s.cardFrame}>
                {d.image ? <img src={d.image} alt="" /> : <span className={s.cardBlank}>{(d.name || '?')[0]}</span>}
                <span className={s.cardName}>
                  {d.name}
                  {d.native && <em lang="ja">{d.native}</em>}
                </span>
                {d.favourites > 0 && (
                  <span className={s.cardHearts}><Heart size={11} fill="currentColor" /> {compact(d.favourites)}</span>
                )}
              </div>
            </div>

            <div className={s.facts}>
              <span className={s.kicker}>Character{signature ? <> · from <Link to={`/anime/${signature.id}`}>{signature.title}</Link></> : null}</span>
              <h1 className={s.name}>{d.name}</h1>
              {d.native && <p className={s.native} lang="ja">{d.native}</p>}
              {(d.aliases.length > 0 || d.spoiler_aliases.length > 0) && (
                <p className={s.aliases}>
                  <span className={s.aliasLabel}>also called</span>
                  {d.aliases.join(' · ')}
                  {d.spoiler_aliases.length > 0 && (
                    showSpoilerNames ? (
                      <span className={s.spoilerNames}>{d.aliases.length ? ' · ' : ''}{d.spoiler_aliases.join(' · ')}</span>
                    ) : (
                      <button type="button" className={s.reveal} onClick={() => setShowSpoilerNames(true)}>
                        <Eye size={11} /> {d.spoiler_aliases.length} spoiler name{d.spoiler_aliases.length === 1 ? '' : 's'}
                      </button>
                    )
                  )}
                </p>
              )}

              <dl className={s.stats}>
                {[['Age', d.age], ['Gender', d.gender], ['Birthday', fuzzyDateLabel(d.birth)], ['Blood type', d.blood_type],
                  ['Appears in', apps.length ? `${apps.length} anime` : null]]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className={s.stat}><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
              </dl>

              <div className={s.actions}>
                {me.data && <FavToggle kind="character" id={d.id} initial={d.is_favourite} count={d.favourites} />}
                {d.site_url && (
                  <a className={s.source} href={d.site_url} target="_blank" rel="noreferrer">AniList <ExternalLink size={11} /></a>
                )}
              </div>
            </div>
          </div>

          {d.description && (
            <section className={s.bio}>
              <h3 className={s.label}>On the back of the card</h3>
              <AniText text={d.description} className={s.bioText} />
            </section>
          )}

          {apps.length > 0 && (
            <section className={s.apps}>
              <div className={s.appsHead}>
                <h3 className={s.label}>Appearances</h3>
                {langs.length > 1 && (
                  <div className={s.langs} role="group" aria-label="Voice language">
                    {langs.map((l) => (
                      <button key={l} type="button" className={l === activeLang ? s.langOn : s.lang} onClick={() => setLang(l)} aria-pressed={l === activeLang}>
                        {l === 'Japanese' ? <span lang="ja">日本語</span> : l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={s.appGrid}>
                {apps.map((a, i) => {
                  const voices = a.voices.filter((v) => v.language === activeLang);
                  return (
                    <div key={a.media.id} className={s.app} style={{ '--i': Math.min(i, 14), '--cover-c': a.media.color || 'var(--c-anime)' }}>
                      <Link to={`/anime/${a.media.id}`} className={s.appCover}>
                        {a.media.cover ? <img src={a.media.cover} alt="" loading="lazy" /> : <span />}
                        <span className={a.role === 'MAIN' ? s.roleMain : s.role}>{ROLE[a.role] || a.role}</span>
                      </Link>
                      <Link to={`/anime/${a.media.id}`} className={s.appTitle}>{a.media.title}</Link>
                      <span className={s.appMeta}>{metaLine(a.media)}</span>
                      {voices.length > 0 ? voices.slice(0, 2).map((v) => (
                        <Link key={`${v.id}-${v.notes || ''}`} to={`/anime/voice/${v.id}`} className={s.voice}>
                          <Avatar src={v.image} name={v.name} imgClass={s.voiceAv} letterClass={s.voiceAvL} />
                          <span>{v.name}{v.notes && <em>{v.notes}</em>}</span>
                        </Link>
                      )) : <span className={s.noVoice}>no {activeLang} credit</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </article>
      )}
    </>
  );
}
