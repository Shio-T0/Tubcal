// Which of Tubcal's modules this copy has: the rooms an install can leave out
// (modules.ini at the repo root lists them and the files each one owns).
//
// Two sources agree on it. The build says what it compiled (__TUBCAL_MODULES__,
// set by build/modules.mjs: the modules chosen at install whose files are on
// disk), and the server says what it serves (window.__TUBCAL_MODULES__, stamped
// into index.html). A module is here when both have it. With neither (the phone
// build, the dev server before the API answers) every module is here.
//
//   hasModule('youtube')                    is it here?
//   moduleLazy('anime', () => import(…))    a lazy component that renders nothing
//                                           when the module isn't here
//
// The core never imports a module's files directly: only through `import()`,
// which build/modules.mjs points at an empty stand-in when the module is left
// out. tests/test_modules.py enforces it.

import { lazy } from 'react';

/* global __TUBCAL_MODULES__ */
const BUILT = typeof __TUBCAL_MODULES__ !== 'undefined' ? __TUBCAL_MODULES__ : null;
const SERVED = typeof window !== 'undefined' && Array.isArray(window.__TUBCAL_MODULES__)
  ? window.__TUBCAL_MODULES__ : null;

/** Every module id there is, installed or not. */
export const KNOWN_MODULES = BUILT ? BUILT.known : [];

/** Is this module here? Ids that aren't modules (core parts) always are. */
export function hasModule(id) {
  if (!BUILT || !BUILT.known.includes(id)) return true;
  return BUILT.on.includes(id) && (!SERVED || SERVED.includes(id));
}

/** The modules this copy leaves out, by id. */
export function missingModules() {
  return KNOWN_MODULES.filter((id) => !hasModule(id));
}

function Nothing() {
  return null;
}

/** React.lazy for something a module owns: `load` is only called when the module
 *  is here, and a missing export (the stand-in has none) renders nothing. */
export function moduleLazy(id, load) {
  return lazy(() => (hasModule(id) ? load() : Promise.resolve({ default: Nothing }))
    .then((m) => ({ default: m?.default || Nothing })));
}

/** Render `children` only when every named module is here. */
export function IfModule({ id, children, fallback = null }) {
  const ids = Array.isArray(id) ? id : [id];
  return ids.every(hasModule) ? children : fallback;
}

/** `moduleLazy` for one named export: moduleLazy('wire', …HNReader.jsx, 'ReaderSheet'). */
export function moduleLazyNamed(id, load, name) {
  return moduleLazy(id, () => load().then((m) => ({ default: m?.[name] })));
}
