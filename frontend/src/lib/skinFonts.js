// Skin-specific fonts are loaded only when their theme is actually selected, so
// the default Shōwa skins never pay for them. Each entry is a lazy import of the
// fontsource CSS; Vite injects the @font-face + woff2 when the chunk loads. Core
// fonts (Fraunces / Schibsted Grotesk / IBM Plex Mono) stay eager in main.jsx.

const LOADERS = {
  terminal: [() => import('@fontsource/vt323')],
  bauhaus: [
    () => import('@fontsource/archivo/400.css'),
    () => import('@fontsource/archivo/600.css'),
    () => import('@fontsource/archivo/900.css'),
  ],
  space: [
    () => import('@fontsource-variable/space-grotesk'),
    () => import('@fontsource-variable/inter'),
  ],
};

const loaded = new Set();

/** Ensure the fonts for `theme` are present. Safe to call on every theme change;
 *  each family is imported at most once. */
export function loadSkinFonts(theme) {
  if (loaded.has(theme)) return;
  loaded.add(theme);
  for (const load of LOADERS[theme] || []) load();
}
