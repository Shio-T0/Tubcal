// How subtitles look: one style, kept in the `subtitle_style` setting, so it's
// permanent and every player reads it: the desktop player, the phone player, and
// both of them on the anime episodes that carry subtitle tracks. The server
// (server/api/settings.py) keeps the same shape and limits, and stamps
// `updated_at`, which the phone⇄desktop data sync uses to keep the newer one.

export const SUBTITLE_DEFAULTS = {
  size: 1, // × the base: 5% of the picture's height
  font: 'sans',
  weight: 600,
  color: '#ffffff',
  edge: 'outline', // none | shadow | outline
  bg: 0, // backdrop opacity behind each line, 0–1
  bg_color: '#000000',
  position: 6, // % of the picture's height between the bottom line and the bottom edge
  lang: '', // preferred track language ('' = the track the source marks default)
  show: true, // subtitles on when an episode starts
};

export const SUBTITLE_LIMITS = { size: [0.5, 2.5], position: [2, 30], bg: [0, 1] };

export const SUBTITLE_FONTS = [
  { value: 'sans', label: 'Sans', css: "var(--font-body), 'Schibsted Grotesk Variable', system-ui, sans-serif" },
  { value: 'serif', label: 'Serif', css: "var(--font-display), 'Fraunces Variable', Georgia, serif" },
  { value: 'mono', label: 'Mono', css: "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace" },
  { value: 'system', label: 'System', css: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif" },
];
export const SUBTITLE_WEIGHTS = [
  { value: 400, label: 'Regular' },
  { value: 600, label: 'Semibold' },
  { value: 800, label: 'Bold' },
];
export const SUBTITLE_EDGES = [
  { value: 'none', label: 'None' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'outline', label: 'Outline' },
];
export const SUBTITLE_COLORS = ['#ffffff', '#fbf1d8', '#ffe45c', '#8ee6ff', '#b7f5a2', '#ffb8d9'];
export const SUBTITLE_LANGS = [
  ['', 'Source default'], ['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'],
  ['de', 'German'], ['it', 'Italian'], ['ar', 'Arabic'], ['ru', 'Russian'], ['id', 'Indonesian'],
  ['ja', 'Japanese'], ['th', 'Thai'], ['vi', 'Vietnamese'],
];

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, [lo, hi], d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const oneOf = (v, list, d) => (list.some((x) => x.value === v) ? v : d);

/** Any stored value (or nothing) → a complete, valid style. */
export function subtitleStyle(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = SUBTITLE_DEFAULTS;
  return {
    size: clamp(r.size, SUBTITLE_LIMITS.size, d.size),
    font: oneOf(r.font, SUBTITLE_FONTS, d.font),
    weight: oneOf(Number(r.weight), SUBTITLE_WEIGHTS, d.weight),
    color: HEX.test(r.color || '') ? r.color : d.color,
    edge: oneOf(r.edge, SUBTITLE_EDGES, d.edge),
    bg: clamp(r.bg, SUBTITLE_LIMITS.bg, d.bg),
    bg_color: HEX.test(r.bg_color || '') ? r.bg_color : d.bg_color,
    position: clamp(r.position, SUBTITLE_LIMITS.position, d.position),
    lang: typeof r.lang === 'string' ? r.lang.slice(0, 8) : d.lang,
    show: r.show !== false,
  };
}

function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

/** A style → the CSS custom properties the subtitle layer reads. `px` is the base
 *  size in pixels (5% of the picture's height), measured by whoever renders it. */
export function subtitleVars(style, px) {
  const s = subtitleStyle(style);
  const font = SUBTITLE_FONTS.find((f) => f.value === s.font).css;
  const o = 'rgba(0, 0, 0, 0.92)';
  const edge = {
    none: 'none',
    shadow: '0 0.06em 0.18em rgba(0, 0, 0, 0.9), 0 0 0.35em rgba(0, 0, 0, 0.55)',
    // eight offsets read as an outline in every engine (no paint-order needed)
    outline: [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
      .map(([x, y]) => `${(x * 0.055).toFixed(3)}em ${(y * 0.055).toFixed(3)}em 0 ${o}`)
      .concat('0 0.05em 0.25em rgba(0, 0, 0, 0.6)').join(', '),
  }[s.edge];
  return {
    '--sub-size': `${Math.max(11, px * s.size).toFixed(1)}px`,
    '--sub-font': font,
    '--sub-weight': s.weight,
    '--sub-color': s.color,
    '--sub-edge': edge,
    '--sub-bg': s.bg > 0 ? rgba(s.bg_color, s.bg) : 'transparent',
    '--sub-bottom': `${s.position}%`,
  };
}

/** Which track to show first: none if subtitles start off; else the preferred
 *  language; else the one the source marks default; else the first. */
export function pickTrack(tracks, style) {
  const s = subtitleStyle(style);
  if (!tracks?.length || !s.show) return -1;
  if (s.lang) {
    const i = tracks.findIndex((t) => (t.lang || '').toLowerCase().startsWith(s.lang));
    if (i >= 0) return i;
  }
  const d = tracks.findIndex((t) => t.default);
  return d >= 0 ? d : 0;
}
