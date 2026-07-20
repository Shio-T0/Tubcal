// No 09 — The Workbench. A shelf of service manuals, one per programming
// language: pull one onto the bench and its whole world opens — talks on film,
// the bench radio, the change log, the reference shelf, and what's being built.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  ExternalLink,
  GitFork,
  Pause,
  Play,
  Star,
} from 'lucide-react';

import { useApi } from '../api/client.js';
import { ErrorBox, Receiving, SectionHead } from '../components/layout/Section.jsx';
import { usePlayer } from '../state.jsx';
import { useHorizontalWheel } from '../lib/useHorizontalWheel.js';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import s from './workbench.module.css';

/* ---------------------------------------------------------------- helpers */

// Which manual is open lives in the URL (?l=), not useState — back/forward
// should land on the same bench. The default language stays out of the URL.
function useLangParam(fallback) {
  const [params, setParams] = useSearchParams();
  const value = params.get('l') || fallback;
  const set = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (!next || next === fallback) p.delete('l');
          else p.set('l', next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams, fallback],
  );
  return [value, set];
}

function fmtClock(secs) {
  if (secs == null || Number.isNaN(secs)) return '--:--';
  const t = Math.max(0, Math.floor(secs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function fmtDate(epoch) {
  if (!epoch) return null;
  return new Date(epoch * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function SecTab({ n, label, note }) {
  return (
    <div className={s.secTabRow}>
      <span className={s.secTab}>
        <span className={s.secNo}>SEC {n}</span>
        {label}
      </span>
      {note && <span className={s.secNote}>{note}</span>}
    </div>
  );
}

/* ------------------------------------------------------------- the shelf */

function SpineShelf({ languages, activeId, onPick }) {
  return (
    <aside className={s.shelf} aria-label="Language manuals">
      <span className={s.shelfLabel}>the shelf</span>
      <div className={s.spines}>
        {languages.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`${s.spine} ${l.id === activeId ? s.spineOpen : ''}`}
            style={{ '--spine-c': l.accent }}
            onClick={() => onPick(l.id)}
            aria-pressed={l.id === activeId}
            title={`${l.name} — ${l.tagline}`}
          >
            <span className={s.spineName}>{l.name}</span>
            <span className={s.spineMascot} aria-hidden>
              {l.mascot}
            </span>
          </button>
        ))}
      </div>
      <span className={s.shelfCount}>
        {String(languages.length).padStart(2, '0')} manuals bound
      </span>
    </aside>
  );
}

/* ----------------------------------------------------------- the dossier */

function Dossier({ lang }) {
  const release = useApi(`/dev/${lang.id}/release`);
  const rel = release.data;

  return (
    <div className={s.dossier}>
      <span className={s.dossierMascot} aria-hidden>
        {lang.mascot}
      </span>
      <div className={s.dossierMain}>
        <span className={s.dossierEyebrow}>service manual · {lang.repo}</span>
        <h2 className={s.dossierName}>{lang.name}</h2>
        <p className={s.dossierTagline}>{lang.tagline}</p>
        <dl className={s.specs}>
          {lang.facts.map(([label, value]) => (
            <div key={label} className={s.specRow}>
              <dt className={s.specLabel}>{label}</dt>
              <span className={s.specDots} aria-hidden />
              <dd className={s.specVal}>{value}</dd>
            </div>
          ))}
        </dl>
        <a className={s.siteLink} href={lang.site} target="_blank" rel="noopener noreferrer">
          {lang.site.replace(/^https?:\/\/(www\.)?/, '')} <ArrowUpRight size={13} />
        </a>
      </div>
      <div className={s.stampWell}>
        {rel?.tag ? (
          <a
            className={s.stamp}
            href={rel.url || lang.site}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={s.stampKicker}>current stable</span>
            <span className={s.stampTag}>{rel.tag}</span>
            {rel.published_at ? (
              <span className={s.stampDate}>{fmtDate(rel.published_at)}</span>
            ) : null}
          </a>
        ) : (
          <div className={`${s.stamp} ${s.stampGhost}`}>
            <span className={s.stampKicker}>current stable</span>
            <span className={s.stampTag}>{release.loading ? '···' : '—'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------- SEC 01 — pictures */

function VideoShelf({ langId }) {
  const { data, loading, error } = useApi(`/dev/${langId}/videos`);
  const { open: playVideo } = usePlayer();
  const rowRef = useHorizontalWheel();
  const items = data?.items || [];

  return (
    <section className={s.panel}>
      <SecTab n="01" label="moving pictures" note="talks & tutorials — plays right here" />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Receiving label="threading the projector" />}
      {!loading && items.length === 0 && !error && (
        <p className={s.empty}>The projector came up empty — search again in a while.</p>
      )}
      <div className={s.filmstrip} ref={rowRef}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={s.filmCard}
            onClick={() => playVideo(item)}
            title={item.title}
          >
            <span className={s.filmThumbWrap}>
              <img className={s.filmThumb} src={item.thumbnail} alt="" loading="lazy" />
              {item.extra?.length_seconds ? (
                <span className={s.filmLen}>{fmtClock(item.extra.length_seconds)}</span>
              ) : null}
              <span className={s.filmPlay} aria-hidden>
                <Play size={16} />
              </span>
            </span>
            <span className={s.filmTitle}>{item.title}</span>
            <span className={s.filmMeta}>
              {item.author}
              {item.score != null ? ` · ${compact(item.score)} views` : ''}
              {item.published_at ? ` · ${timeAgo(item.published_at)}` : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ SEC 02 — the air */

function BenchRadio({ episode, playing, onToggle, audioRef }) {
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const onTime = () => setPos(el.currentTime);
    const onMeta = () => setDur(el.duration);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, [audioRef, episode?.id]);

  if (!episode) {
    return (
      <div className={`${s.radio} ${s.radioIdle}`}>
        <span className={s.radioDial} aria-hidden />
        <span className={s.radioIdleText}>bench radio — pick an episode below to tune in</span>
      </div>
    );
  }

  const total = dur || episode.duration || 0;
  return (
    <div className={s.radio}>
      {episode.show_art && <img className={s.radioArt} src={episode.show_art} alt="" />}
      <button
        type="button"
        className={s.radioBtn}
        onClick={onToggle}
        aria-label={playing ? 'Pause episode' : 'Play episode'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
      </button>
      <div className={s.radioMain}>
        <span className={s.radioTitle}>{episode.title}</span>
        <div className={s.radioSeekRow}>
          <span className={s.radioTime}>{fmtClock(pos)}</span>
          <input
            className={s.radioSeek}
            type="range"
            min={0}
            max={total || 1}
            step={1}
            value={Math.min(pos, total || 1)}
            onChange={(e) => {
              const el = audioRef.current;
              if (el) el.currentTime = Number(e.target.value);
            }}
            aria-label="Seek within episode"
          />
          <span className={s.radioTime}>{fmtClock(total)}</span>
        </div>
        <span className={s.radioShow}>{episode.show}</span>
      </div>
    </div>
  );
}

function PodcastSection({ langId, radio }) {
  const { data, loading, error } = useApi(`/dev/${langId}/podcasts`);
  const episodes = data?.episodes || [];
  const shows = [...new Set(episodes.map((e) => e.show))];

  return (
    <section className={s.panel}>
      <SecTab
        n="02"
        label="on the air"
        note={shows.length ? `tuned to ${shows.join(' · ')}` : 'the language on the radio'}
      />
      <BenchRadio {...radio} />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Receiving label="warming the valves" />}
      {!loading && episodes.length === 0 && !error && (
        <p className={s.empty}>Nothing on the air — the shows may be between seasons.</p>
      )}
      <div className={s.episodes}>
        {episodes.slice(0, 12).map((ep) => {
          const isCurrent = radio.episode?.id === ep.id;
          return (
            <div key={ep.id} className={`${s.episode} ${isCurrent ? s.episodeOn : ''}`}>
              <button
                type="button"
                className={s.epPlay}
                onClick={() => radio.onPick(ep)}
                aria-label={isCurrent && radio.playing ? `Pause ${ep.title}` : `Play ${ep.title}`}
              >
                {isCurrent && radio.playing ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
              </button>
              <div className={s.epMain}>
                <span className={s.epTitle}>{ep.title}</span>
                <span className={s.epMeta}>
                  {ep.show}
                  {ep.published_at ? ` · ${timeAgo(ep.published_at)}` : ''}
                  {ep.duration ? ` · ${fmtClock(ep.duration)}` : ''}
                </span>
              </div>
              {ep.url && (
                <a
                  className={s.epLink}
                  href={ep.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Episode notes"
                >
                  <ExternalLink size={13} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------- SEC 03 — change log */

function Updates({ langId }) {
  const { data, loading, error } = useApi(`/dev/${langId}/updates`);
  const items = data?.items || [];
  const releases = items.filter((i) => i.type === 'release').slice(0, 6);
  const posts = items.filter((i) => i.type === 'blog').slice(0, 10);

  return (
    <section className={s.panel}>
      <SecTab n="03" label="change log" note="releases & dispatches from the core team" />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Receiving label="pulling the wire" />}
      {!loading && items.length === 0 && !error && (
        <p className={s.empty}>The wire is quiet — nothing has landed lately.</p>
      )}
      <div className={`${s.logGrid} ${releases.length === 0 ? s.logGridSolo : ''}`}>
        {releases.length > 0 && (
          <div className={s.logCol}>
            <span className={s.logColHead}>cut releases</span>
            {releases.map((r) => (
              <a
                key={r.id}
                className={s.releaseRow}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={s.releaseTag}>
                  {r.tag}
                  {r.prerelease ? <em> pre</em> : null}
                </span>
                <span className={s.releaseTitle}>{r.title}</span>
                {r.published_at ? (
                  <span className={s.releaseDate}>{fmtDate(r.published_at)}</span>
                ) : null}
              </a>
            ))}
          </div>
        )}
        <div className={s.logCol}>
          <span className={s.logColHead}>dispatches</span>
          {posts.map((p) => (
            <a
              key={p.id}
              className={s.postRow}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={s.postSource}>{p.source}</span>
              <span className={s.postTitle}>{p.title}</span>
              {p.published_at ? <span className={s.postDate}>{timeAgo(p.published_at)}</span> : null}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------- SEC 04 — reference shelf */

const KIND_LABEL = { book: 'bound', reference: 'lookup', practice: 'hands-on', tool: 'bench tool' };

function ReferenceShelf({ lang }) {
  return (
    <section className={s.panel}>
      <SecTab n="04" label="reference shelf" note="the manuals worth keeping in reach" />
      <div className={s.docGrid}>
        {lang.docs.map((d) => (
          <a
            key={d.url}
            className={s.docCard}
            data-kind={d.kind}
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={s.docKind}>{KIND_LABEL[d.kind] || d.kind}</span>
            <span className={s.docTitle}>{d.title}</span>
            <span className={s.docNote}>{d.note}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------- SEC 05 — the floor */

function FloorSection({ langId }) {
  const { data, loading, error } = useApi(`/dev/${langId}/repos`);
  const items = (data?.items || []).slice(0, 10);

  return (
    <section className={s.panel}>
      <SecTab n="05" label="the floor" note="what's being built this week, in this language" />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Receiving label="walking the floor" />}
      {!loading && items.length === 0 && !error && (
        <p className={s.empty}>The floor is dark — GitHub had nothing fresh to show.</p>
      )}
      <div className={s.floor}>
        {items.map((item, i) => (
          <a
            key={item.id}
            className={s.repoRow}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={s.repoRank}>{String(i + 1).padStart(2, '0')}</span>
            <span className={s.repoMain}>
              <span className={s.repoName}>{item.source || item.title}</span>
              {item.extra?.description && (
                <span className={s.repoDesc}>{item.extra.description}</span>
              )}
            </span>
            <span className={s.repoStats}>
              {item.extra?.stars != null && (
                <span>
                  <Star size={11} /> {compact(item.extra.stars)}
                </span>
              )}
              {item.extra?.forks != null && (
                <span>
                  <GitFork size={11} /> {compact(item.extra.forks)}
                </span>
              )}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- the room */

export default function Workbench() {
  const [langId, setLangId] = useLangParam('rust');
  const languages = useApi('/dev/languages');
  const dossier = useApi(`/dev/${langId}`);

  // The bench radio outlives language switches — one <audio>, page-scoped,
  // so an episode keeps playing while you leaf through another manual.
  const audioRef = useRef(null);
  const [episode, setEpisode] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const onEnd = () => setPlaying(false);
    el.addEventListener('ended', onEnd);
    return () => el.removeEventListener('ended', onEnd);
  }, []);

  const pickEpisode = useCallback(
    (ep) => {
      const el = audioRef.current;
      if (!el) return;
      if (episode?.id === ep.id) {
        if (el.paused) {
          el.play();
          setPlaying(true);
        } else {
          el.pause();
          setPlaying(false);
        }
        return;
      }
      setEpisode(ep);
      el.src = ep.audio;
      el.play().catch(() => setPlaying(false));
      setPlaying(true);
    },
    [episode],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !episode) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [episode]);

  const radio = { episode, playing, onPick: pickEpisode, onToggle: toggle, audioRef };
  const lang = dossier.data;
  const accent = lang?.accent || languages.data?.languages?.find((l) => l.id === langId)?.accent;

  return (
    <>
      <SectionHead
        kicker="No 09 — The Workbench"
        title="One language on the bench"
        note="Pull a manual from the shelf: its films, its radio, its change log, its references — all laid out."
        color="var(--c-dev)"
      />

      <div className={s.bench} style={accent ? { '--lang-c': accent } : undefined}>
        {languages.error && <ErrorBox message={languages.error} />}
        {languages.data && (
          <SpineShelf
            languages={languages.data.languages}
            activeId={langId}
            onPick={setLangId}
          />
        )}

        {/* keyed on language so the whole manual re-runs its entrance */}
        <div className={s.manual} key={langId}>
          {dossier.error && <ErrorBox message={dossier.error} />}
          {dossier.loading && !lang && <Receiving label="pulling the manual" />}
          {lang && (
            <>
              <Dossier lang={lang} />
              <VideoShelf langId={langId} />
              <PodcastSection langId={langId} radio={radio} />
              <Updates langId={langId} />
              <ReferenceShelf lang={lang} />
              <FloorSection langId={langId} />
            </>
          )}
        </div>
      </div>

      {/* the one radio valve — never unmounted, so audio survives re-renders */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="none" />
    </>
  );
}
