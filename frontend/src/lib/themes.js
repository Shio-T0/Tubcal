// Every selectable skin in one place — consumed by the Settings picker and the
// Masthead switcher. `value` is what gets written to <html data-theme>; the CSS
// for each lives in styles/tokens.css (dark/light) and styles/themes.css (rest).
// `swatch` is just the three dots shown on the picker card.

export const THEMES = [
  {
    value: 'dark',
    label: 'Shōwa Night',
    blurb: 'The house look — warm wood cabinet, amber tube.',
    swatch: ['#1c140d', '#e6ab5e', '#e8d9b8'],
  },
  {
    value: 'light',
    label: 'Shōwa Day',
    blurb: 'Same set, tatami daylight.',
    swatch: ['#e6d8bb', '#b06a26', '#2a1d12'],
  },
  {
    value: 'terminal',
    label: 'Phosphor Terminal',
    blurb: 'An older machine. Green text on a black tube.',
    swatch: ['#05080a', '#33ff66', '#ffb000'],
  },
  {
    value: 'aqua',
    label: 'Aqua Y2K',
    blurb: 'Glossy turn-of-the-century desktop.',
    swatch: ['#eef3fb', '#1a73e8', '#28c840'],
  },
  {
    value: 'bauhaus',
    label: 'Bauhaus Print',
    blurb: 'Off the screen — a constructivist poster.',
    swatch: ['#f4f1e9', '#e2231a', '#0b4ee2'],
  },
  {
    value: 'blueprint',
    label: 'Blueprint',
    blurb: 'Cyan hairlines on drafting navy.',
    swatch: ['#081a33', '#5fd0ff', '#ffb454'],
  },
  {
    value: 'space',
    label: 'Deep Space',
    blurb: 'Glass panels adrift over a nebula.',
    swatch: ['#05060c', '#7c5cff', '#22d3ee'],
  },
];

export const DEFAULT_THEME = 'dark';

const VALUES = THEMES.map((t) => t.value);

export function themeMeta(value) {
  return THEMES.find((t) => t.value === value) || THEMES[0];
}

/** The skin after `value` in the list, wrapping around — drives the Masthead cycler. */
export function nextTheme(value) {
  const i = VALUES.indexOf(value);
  return VALUES[(i + 1) % VALUES.length] || DEFAULT_THEME;
}
