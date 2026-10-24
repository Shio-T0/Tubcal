// The Workbench (Coding channel). A shelf of service manuals, one per programming
// language: pull one onto the bench and its whole world opens — talks on film,
// the bench radio, the change log, the reference shelf, and what's being built.
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  ExternalLink,
  GitFork,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  Star,
} from 'lucide-react';

import { hasModule } from '../lib/modules.js';
import { useApi } from '../api/client.js';
import { ErrorBox, Receiving } from '../components/layout/Section.jsx';
import RadioHost from '../components/radio/RadioHost.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { devPostItem, docItem, podcastItem } from '../lib/saveable.js';
import { usePlayer } from '../state.jsx';
import { useHorizontalWheel } from '../lib/useHorizontalWheel.js';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { seek, toggle, tune, useRadio, useRadioClock, useRadioPlaces } from '../lib/radio.js';
import { chooseSleep, nextSleepChoice, sleepLabel, useSleepCountdown } from '../lib/sleepTimer.js';
import s from './workbench.module.css';

/* global __TUBCAL_APP__ */
// The bench radio plays on across the app (its host is at the root). The phone has
// no bar to show it in, so there the page hosts it and leaving ends the broadcast.
const PHONE = typeof __TUBCAL_APP__ !== 'undefined' && !!__TUBCAL_APP__.phone;

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

function VideoShelf({ langId, n }) {
  const { data, loading, error } = useApi(`/dev/${langId}/videos`);
  const { open: playVideo } = usePlayer();
  const rowRef = useHorizontalWheel();
  const items = data?.items || [];

  return (
    <section className={s.panel}>
      <SecTab n={n} label="moving pictures" note="talks & tutorials — plays right here" />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Receiving label="threading the projector" />}
      {!loading && items.length === 0 && !error && (
        <p className={s.empty}>The projector came up empty — search again in a while.</p>
      )}
      <div className={s.filmstrip} ref={rowRef}>
        {items.map((item) => (
          // a div, not a button: the bookmark inside is a button of its own
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            className={s.filmCard}
            onClick={() => playVideo(item)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); playVideo(item); }
            }}
            title={item.title}
          >
            <SaveButton item={item} className={s.filmSave} />
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
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ SEC 02 — the air */

function BenchRadio() {
  const { episode, playing, waiting } = useRadio();
  const { pos, dur } = useRadioClock();

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
        onClick={toggle}
        aria-label={playing ? 'Pause episode' : 'Play episode'}
      >
        {playing && waiting ? <LoaderCircle size={16} className={s.spin} />
          : playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
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
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek within episode"
          />
          <span className={s.radioTime}>{fmtClock(total)}</span>
        </div>
        <span className={s.radioShow}>{episode.show}</span>
      </div>
      <SleepDial />
    </div>
  );
}

/** The radio's sleep dial: each press steps off → end of this episode → 15 → 30
 *  → 60 minutes, the same timer as the player's moon. */
function SleepDial() {
  const sleep = useSleepCountdown();
  const tag = sleepLabel(sleep);
  const words = tag === 'end' ? 'at the end of this episode' : tag ? `in ${tag.replace('m', ' min')}` : null;
  return (
    <button
      type="button"
      className={`${s.radioSleep} ${tag ? s.radioSleepOn : ''}`}
      onClick={() => chooseSleep(nextSleepChoice(sleep))}
      aria-label={words ? `Sleep timer: ${words}` : 'Sleep timer'}
      title={words ? `Sleeps ${words} · press to change` : 'Sleep timer'}
    >
      <Moon size={14} />
      {tag && <span>{tag}</span>}
    </button>
  );
}

function PodcastSection({ langId, lang, n }) {
  const { data, loading, error } = useApi(`/dev/${langId}/podcasts`);
  const radio = useRadio();
  const places = useRadioPlaces();
  const episodes = data?.episodes || [];
  const shows = [...new Set(episodes.map((e) => e.show))];

  return (
    <section className={s.panel}>
      <SecTab
        n={n}
        label="on the air"
        note={shows.length ? `tuned to ${shows.join(' · ')}` : 'the language on the radio'}
      />
      <BenchRadio />
      {error && <ErrorBox message={error} />}
      {loading && !data && <Receiving label="warming the valves" />}
      {!loading && episodes.length === 0 && !error && (
        <p className={s.empty}>Nothing on the air — the shows may be between seasons.</p>
      )}
      <div className={s.episodes}>
        {episodes.slice(0, 12).map((ep) => {
          const isCurrent = radio.episode?.id === ep.id;
          const stopped = !isCurrent && ep.duration && places.find(([id]) => id === ep.id)?.[1];
          return (
            <div key={ep.id} className={`${s.episode} ${isCurrent ? s.episodeOn : ''}`}>
              <button
                type="button"
                className={s.epPlay}
                onClick={() => (isCurrent ? toggle() : tune({ ...ep, lang: langId, accent: lang?.accent }))}
                aria-label={isCurrent && radio.playing ? `Pause ${ep.title}` : `Play ${ep.title}`}
              >
                {isCurrent && radio.playing ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
              </button>
              <div className={s.epMain}>
                <span className={s.epTitle}>{ep.title}</span>
                <span className={s.epMeta}>
                  {ep.show}
                  {ep.published_at ? ` · ${timeAgo(ep.published_at)}` : ''}
                  {stopped ? ` · ${fmtClock(ep.duration - stopped)} left` : ep.duration ? ` · ${fmtClock(ep.duration)}` : ''}
                </span>
              </div>
              <SaveButton item={podcastItem(ep, langId)} className={s.save} />
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

function Updates({ langId, n }) {
  const { data, loading, error } = useApi(`/dev/${langId}/updates`);
  const items = data?.items || [];
  const releases = items.filter((i) => i.type === 'release').slice(0, 6);
  const posts = items.filter((i) => i.type === 'blog').slice(0, 10);

  return (
    <section className={s.panel}>
      <SecTab n={n} label="change log" note="releases & dispatches from the core team" />
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
                <SaveButton item={devPostItem(r, langId)} className={s.save} size={13} />
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
              {p.published_at ? <span className={s.postDate}>{timeAgo(p.published_at)}</span> : <span />}
              <SaveButton item={devPostItem(p, langId)} className={s.save} size={13} />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------- SEC 04 — reference shelf */

const KIND_LABEL = { book: 'bound', reference: 'lookup', practice: 'hands-on', tool: 'bench tool' };

function ReferenceShelf({ lang, n }) {
  return (
    <section className={s.panel}>
      <SecTab n={n} label="reference shelf" note="the manuals worth keeping in reach" />
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
            <SaveButton item={docItem(d, lang.name)} className={s.docSave} size={13} />
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

function FloorSection({ langId, n }) {
  const { data, loading, error } = useApi(`/dev/${langId}/repos`);
  const items = (data?.items || []).slice(0, 10);

  return (
    <section className={s.panel}>
      <SecTab n={n} label="the floor" note="what's being built this week, in this language" />
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
            <SaveButton item={item} className={s.save} size={13} />
          </a>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- the room */

// The manual's sections in order. Talks play through the Screening Room's player
// and the floor's repos come from GitHub, so those two need their modules.
const SECTIONS = [
  { id: 'videos', Section: VideoShelf, module: 'youtube' },
  { id: 'podcasts', Section: PodcastSection },
  { id: 'updates', Section: Updates },
  { id: 'reference', Section: ReferenceShelf },
  { id: 'floor', Section: FloorSection, module: 'github' },
];
const sections = SECTIONS.filter((x) => !x.module || hasModule(x.module));

export default function Workbench() {
  const [langId, setLangId] = useLangParam('rust');
  const languages = useApi('/dev/languages');
  const dossier = useApi(`/dev/${langId}`);

  const lang = dossier.data;
  const accent = lang?.accent || languages.data?.languages?.find((l) => l.id === langId)?.accent;

  return (
    <>
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
              {sections.map(({ id, Section }, i) => (
                <Section key={id} n={String(i + 1).padStart(2, '0')} langId={langId} lang={lang} />
              ))}
            </>
          )}
        </div>
      </div>

      {PHONE && <RadioHost />}
    </>
  );
}
