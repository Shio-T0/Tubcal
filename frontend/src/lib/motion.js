// Whether the screen should keep still: Fast mode is on (Settings → Appearance,
// stamped as <html data-fast>), or the system asks for reduced motion. CSS
// handles every animation and transition by itself (styles/base.css); this is
// for the motion scripts make — count-ups, smooth scrolling, staged reveals.

export function isStill() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.hasAttribute('data-fast')
    || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** `behavior` for scrollIntoView / scrollTo: a glide, or a jump when still. */
export const scrollMotion = () => (isStill() ? 'auto' : 'smooth');
