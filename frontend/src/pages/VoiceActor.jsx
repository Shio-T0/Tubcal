// The voice actor's dossier — a personnel file from the station's archive.
//
// Deliberately a third texture: the media page is banner art, the cast sheet is a
// dotted programme, and this is a filing-cabinet record. A mounted file photo, a
// ruled ledger of vitals, the bio as typed copy, and a filmography where the show's
// cover carries the character's face pinned to its corner — because a seiyuu's work
// is neither the show nor the character alone, it's the pairing.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Heart } from 'lucide-react';

import { useApi } from '../api/client.js';
import { ErrorBox, Receiving } from '../components/layout/Section.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { compact } from '../lib/format.js';
import { FavToggle, metaLine } from '../components/anime/shared.jsx';
import s from './voiceactor.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** AniList birthdays are frequently day+month with no year. Render exactly what's
 *  known rather than inventing a year or dropping the date. */
function fuzzyDate(d) {
  if (!d) return null;
  const { year, month, day } = d;
  const md = month ? `${MONTHS[month - 1]}${day ? ` ${day}` : ''}` : null;
  if (md && year) return `${md}, ${year}`;
  return md || (year ? String(year) : null);
}

function yearsActive(ya) {
  if (!ya?.start) return null;
  return ya.end ? `${ya.start} – ${ya.end}` : `${ya.start} – present`;
}

/** AniList bios are markdown-ish: __bold__, ~!spoilers!~, raw newlines. Render the
 *  emphasis, keep the paragraphs, and never leak a spoiler into a first paint. */
function bioSegments(text) {
  const withoutSpoilers = text.replace(/~!([\s\S]*?)!~/g, '');
  return withoutSpoilers
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
const hasSpoilers = (text) => /~!([\s\S]*?)!~/.test(text || '');

// AniList staff bios are written in the site's own markdown dialect. In practice
// only two things show up: __bold__ labels ("__Agency:__ Aoni Production") and
// [text](url) links to an agency profile. Left unhandled they print as literal
// brackets and underscores, which is how you know nobody looked at the page.
const MD_TOKEN = /__(.+?)__|\[([^\]]+)\]\(([^)\s]+)\)/g;

function Emphasis({ text }) {
  const out = [];
  let last = 0;
  let m;
  MD_TOKEN.lastIndex = 0; // the regex is module-level and stateful with /g
  while ((m = MD_TOKEN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<b key={m.index}>{m[1]}</b>);
    } else if (/^https?:\/\//i.test(m[3])) {
      out.push(
        <a key={m.index} className={s.bioLink} href={m[3]} target="_blank" rel="noreferrer">
          {m[2]}
        </a>,
      );
    } else {
      out.push(m[2]); // a non-http target isn't worth trusting; keep the words
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Bio({ text }) {
  const [open, setOpen] = useState(false);
  const paras = bioSegments(text);
  if (!paras.length) return null;
  const shown = open ? paras : paras.slice(0, 2);
  return (
    <div className={s.bio}>
      <span className={s.ledgerLabel}>Notes</span>
      <div className={s.bioBody}>
        {shown.map((p, i) => (
          <p key={i} className={s.bioPara}>
            <Emphasis text={p} />
          </p>
        ))}
        {paras.length > 2 && (
          <button className={s.more} onClick={() => setOpen((v) => !v)}>
            {open ? 'less' : 'read the rest'}
          </button>
        )}
        {hasSpoilers(text) && (
          <p className={s.spoilerNote}>Spoiler passages from AniList are not shown.</p>
        )}
      </div>
    </div>
  );
}

/** One line of the vitals ledger. Renders nothing at all when the fact is unknown —
 *  an empty row is worse than a shorter ledger. */
function Vital({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={s.vital}>
      <dt className={s.vitalLabel}>{label}</dt>
      <dd className={s.vitalValue}>{value}</dd>
    </div>
  );
}

const ROLE_ORDER = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };

/** The role they're *known* for — the art behind the file should be the one the
 *  name summons. Ranked by the character's own AniList favourites rather than the
 *  show's popularity: favourites are a vote on the character, which is what being
 *  known for a part actually means, and it stops a bit player in a huge franchise
 *  from outranking a beloved lead. Falls back to the first role, which AniList has
 *  already sorted by the show's popularity, when nobody has favourites at all. */
function signatureRole(roles) {
  let best = null;
  let bestFav = 0;
  for (const r of roles) {
    for (const c of r.characters) {
      if ((c.favourites || 0) > bestFav) {
        bestFav = c.favourites;
        best = { role: r, character: c };
      }
    }
  }
  if (best) return best;
  const first = roles[0];
  return first ? { role: first, character: first.characters[0] } : null;
}

function RoleCard({ entry, index = 0 }) {
  const m = entry.media;
  const lead = entry.characters[0];
  return (
    <li className={s.role} style={{ '--i': Math.min(index, 12) }}>
      <Link to={`/anime/${m.id}`} className={s.roleLink}>
        <div className={s.roleArt}>
          {m.cover ? (
            <img className={s.roleCover} src={m.cover} alt="" loading="lazy" />
          ) : (
            <div className={s.roleCoverFallback} />
          )}
          {/* The character is pinned to the show's corner — the pairing *is* the credit. */}
          <Avatar
            src={lead?.image}
            name={lead?.name || '?'}
            imgClass={s.roleFace}
            letterClass={s.roleFaceFallback}
          />
          <span className={`${s.roleBadge} ${entry.role === 'MAIN' ? s.roleBadgeMain : ''}`}>
            {entry.role === 'MAIN' ? 'main' : entry.role === 'SUPPORTING' ? 'support' : 'bg'}
          </span>
        </div>
        <p className={s.roleChar}>{lead?.name || '—'}</p>
        {lead?.native && (
          <p className={s.roleCharNative} lang="ja">{lead.native}</p>
        )}
        <p className={s.roleShow}>{m.title}</p>
        <p className={s.roleMeta}>
          {m.year || m.start_year || '—'}
          {m.format && <> · {m.format.replace(/_/g, ' ').toLowerCase()}</>}
          {entry.characters.length > 1 && <> · +{entry.characters.length - 1} more</>}
        </p>
      </Link>
    </li>
  );
}

export default function VoiceActor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const va = useApi(`/anime/staff/${id}`);
  const me = useApi('/anime/me');
  const [onlyMain, setOnlyMain] = useState(false);
  const [allCredits, setAllCredits] = useState(false);
  const d = va.data;

  // Signature comes off the untouched list: AniList's own popularity order is the
  // tiebreaker, and the display sort below would destroy it.
  const signature = d ? signatureRole(d.roles || []) : null;
  const art = signature && (signature.role.media.banner || signature.role.media.cover_xl);
  const roles = (d?.roles || [])
    .slice()
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
  const mains = roles.filter((r) => r.role === 'MAIN').length;
  const shown = onlyMain ? roles.filter((r) => r.role === 'MAIN') : roles;

  return (
    <>
      <button onClick={() => navigate(-1)} className={s.back}>
        <ArrowLeft size={13} /> back
      </button>

      {va.error && <ErrorBox message={va.error} />}
      {va.loading && !d && <Receiving label="pulling the file" />}

      {d && (
        <article className={s.file}>
          <header
            className={s.head}
            style={signature?.role.media.color ? { '--art-c': signature.role.media.color } : undefined}
          >
            {/* The work they're known for, bled in behind the record. It fades out
                to the left before it ever reaches the name or the ledger. */}
            {art && (
              <div
                className={`${s.headArt} ${signature.role.media.banner ? '' : s.headArtCover}`}
                style={{ backgroundImage: `url(${art})` }}
                aria-hidden="true"
              />
            )}

            {/* A commemorative stamp for the part they're known for, franked onto
                the file over the show's own art. Decorative by design — the same
                fact is stated in words in the "known for" line above, so screen
                readers skip it rather than hear the character twice. */}
            {signature?.character?.image && (
              <div className={s.stampWrap} aria-hidden="true">
                <div className={s.stampCard}>
                  <div className={s.stampInner}>
                    <img className={s.stampFace} src={signature.character.image} alt="" loading="lazy" />
                    <div className={s.stampCaption}>
                      <span className={s.stampName} lang="ja">
                        {signature.character.native || signature.character.name}
                      </span>
                      <span className={s.stampYear}>
                        {signature.role.media.start_year || signature.role.media.year || ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Photo corners: the picture is mounted onto the file, not printed on it. */}
            <div className={s.plate}>
              <div className={s.photoWrap}>
                {d.image ? (
                  <img className={s.photo} src={d.image} alt="" />
                ) : (
                  <div className={s.photoFallback}>{(d.name || '?').charAt(0)}</div>
                )}
                <i className={`${s.corner} ${s.cornerTL}`} />
                <i className={`${s.corner} ${s.cornerTR}`} />
                <i className={`${s.corner} ${s.cornerBL}`} />
                <i className={`${s.corner} ${s.cornerBR}`} />
              </div>
              {d.language && <span className={s.stamp}>{d.language}</span>}
            </div>

            <div className={s.ident}>
              <p className={s.fileNo}>
                File No {String(d.id).padStart(6, '0')}
                {d.occupations?.length > 0 && <> · {d.occupations.join(' · ')}</>}
              </p>
              <h1 className={s.name}>{d.name}</h1>
              {d.native && <p className={s.native} lang="ja">{d.native}</p>}
              {d.aliases.length > 0 && (
                <p className={s.aliases}>
                  <span className={s.aliasLabel}>also known as</span>
                  {/* AniList sometimes packs several aliases into one string joined
                      by U+201A rather than a comma; split so each reads as a name. */}
                  {d.aliases.flatMap((a) => a.split(/[,‚]/)).map((a) => a.trim()).filter(Boolean).join(' · ')}
                </p>
              )}

              {/* Names the art. Without this the backdrop is just decoration; with
                  it, the file tells you why that particular show is behind it. */}
              {signature && (
                <p className={s.known}>
                  <span className={s.aliasLabel}>known for</span>
                  <Link to={`/anime/${signature.role.media.id}`} className={s.knownLink}>
                    {signature.character?.name}
                    <span className={s.knownIn}> in {signature.role.media.title}</span>
                  </Link>
                </p>
              )}

              <dl className={s.vitals}>
                <Vital label="Born" value={fuzzyDate(d.birth)} />
                <Vital label="Died" value={fuzzyDate(d.death)} />
                <Vital label="Age" value={d.age} />
                <Vital label="Gender" value={d.gender} />
                <Vital label="Home town" value={d.home_town} />
                <Vital label="Blood type" value={d.blood_type} />
                <Vital label="Active" value={yearsActive(d.years_active)} />
                <Vital
                  label="Fans"
                  value={
                    d.favourites > 0 ? (
                      <span className={s.fans}>
                        <Heart size={10} /> {compact(d.favourites)}
                      </span>
                    ) : null
                  }
                />
              </dl>

              <div className={s.fileActions}>
                {me.data && <FavToggle kind="staff" id={d.id} initial={d.is_favourite} count={d.favourites} />}
                {d.site_url && (
                  <a className={s.source} href={d.site_url} target="_blank" rel="noreferrer">
                    AniList record <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          </header>

          {d.description && <Bio text={d.description} />}

          {roles.length > 0 && (
            <section className={s.roles}>
              <div className={s.rolesHead}>
                <span className={s.ledgerLabel}>
                  Roles <span className={s.rolesCount}>{roles.length}</span>
                </span>
                {mains > 0 && mains < roles.length && (
                  <button
                    className={`${s.filter} ${onlyMain ? s.filterOn : ''}`}
                    onClick={() => setOnlyMain((v) => !v)}
                    aria-pressed={onlyMain}
                  >
                    leading roles only <span className={s.filterCount}>{mains}</span>
                  </button>
                )}
              </div>
              <ol className={s.roleGrid}>
                {shown.map((r, i) => (
                  <RoleCard key={`${r.media.id}-${r.characters[0]?.id}`} entry={r} index={i} />
                ))}
              </ol>
              <p className={s.rolesNote}>
                Most popular first, as ranked by AniList.
              </p>
            </section>
          )}

          {/* Production credits — directing, writing, music, theme songs. For a
              seiyuu this is usually their singing; for everyone else it's the work. */}
          {d.credits?.length > 0 && (
            <section className={s.roles}>
              <div className={s.rolesHead}>
                <span className={s.ledgerLabel}>
                  Production credits <span className={s.rolesCount}>{d.credits.length}</span>
                </span>
              </div>
              <ol className={s.creditList}>
                {(allCredits ? d.credits : d.credits.slice(0, 12)).map((c, i) => (
                  <li key={c.media.id} className={s.credit} style={{ '--i': Math.min(i, 12) }}>
                    <Link to={`/anime/${c.media.id}`} className={s.creditCover}>
                      {c.media.cover ? <img src={c.media.cover} alt="" loading="lazy" /> : <span />}
                    </Link>
                    <span className={s.creditInfo}>
                      <Link to={`/anime/${c.media.id}`} className={s.creditTitle}>{c.media.title}</Link>
                      <span className={s.creditMeta}>{metaLine(c.media)}</span>
                      <span className={s.creditRoles}>{c.roles.join(' · ')}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {d.credits.length > 12 && (
                <button className={s.filter} onClick={() => setAllCredits((v) => !v)}>
                  {allCredits ? 'fewer' : `all ${d.credits.length} credits`}
                </button>
              )}
            </section>
          )}
        </article>
      )}
    </>
  );
}
