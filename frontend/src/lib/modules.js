// Which of Tubcal's modules this copy has: the rooms an install can leave out
// (modules.ini at the repo root lists them and the files each one owns).
//
// Two sources agree on it. The build says what it compiled (__TUBCAL_MODULES__,
// set by build/modules.mjs: the modules chosen at install whose files are on
// disk), and the server says what it serves (window.__TUBCAL_MODULES__, stamped
// into index.html). A module is here when both have it. The phone app's build
// makes every room the phone can have, the phone gets the split APKs of the
// rooms `tubcal phone` installed, and its server says which those are. With
// neither (the dev server before the API answers) every module is here.
//
//   hasModule('youtube')                    is it here?
//   moduleLazy('anime', () => import(…))    a lazy component that renders nothing
//                                           when the module isn't here
//
// The core never imports a module's files directly: only through `import()`,
// which build/modules.mjs points at an empty stand-in when the module is left
// out. tests/test_modules.py enforces it.

import { lazy } from 'react';

/* global __TUBCAL_MODULES__, __TUBCAL_APP__ */
const BUILT = typeof __TUBCAL_MODULES__ !== 'undefined' ? __TUBCAL_MODULES__ : null;
const SERVED = typeof window !== 'undefined' && Array.isArray(window.__TUBCAL_MODULES__)
  ? window.__TUBCAL_MODULES__ : null;
const PHONE = typeof __TUBCAL_APP__ !== 'undefined' && !!__TUBCAL_APP__.phone;

/** Every module id there is, installed or not. */
export const KNOWN_MODULES = BUILT ? BUILT.known : [];

/** Is this module here? Ids that aren't modules (core parts) always are. */
export function hasModule(id) {
  if (!BUILT || !BUILT.known.includes(id)) return true;
  return BUILT.on.includes(id) && (!SERVED || SERVED.includes(id));
}

/** The modules this copy leaves out, by id. On the phone, only those the app
 *  can have (not the Composing Room): the ones `tubcal phone` left out. */
export function missingModules() {
  return KNOWN_MODULES.filter((id) => !hasModule(id) && (!PHONE || BUILT.on.includes(id)));
}

/** What to type to add a left-out module back: `tubcal add anime`, or from the
 *  phone app `tubcal phone add anime` (on the computer, with the phone plugged in). */
export function addCommand(id) {
  return `${PHONE ? 'tubcal phone add' : 'tubcal add'} ${id}`;
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
