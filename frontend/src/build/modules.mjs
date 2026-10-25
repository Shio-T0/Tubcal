// A Vite plugin that builds only the modules this copy has (modules.ini at the
// repo root lists them and the files each one owns).
//
// A module is built when it's chosen — TUBCAL_MODULES, a comma list install.sh
// passes (unset = all of them) — its frontend files are on disk, and every
// module it needs is built too. The page learns the result as the constant
// __TUBCAL_MODULES__ ({known, on}; lib/modules.js reads it).
//
// The core reaches a module's files only through `import()` (lib/modules.js,
// App.jsx's routes). An import of a file whose module isn't built resolves to a
// stand-in that exports a component rendering nothing, so the build neither
// fails on a file install.sh left out nor bundles one it didn't.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ABSENT = '\0tubcal-absent:';

/** modules.ini → {id: {name, needs: [], paths: [], …}} (sections with a name). */
export function readManifest(file) {
  const out = {};
  let sec = null;
  let key = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*([#;]|$)/.test(raw)) continue;
    const head = raw.match(/^\[([^\]]+)\]\s*$/);
    if (head) { sec = out[head[1]] = { id: head[1] }; key = null; continue; }
    if (!sec) continue;
    if (/^\s/.test(raw)) { if (key) sec[key] += ` ${raw.trim()}`; continue; }
    const kv = raw.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kv) { key = kv[1].trim().toLowerCase(); sec[key] = kv[2].trim(); }
  }
  for (const [id, m] of Object.entries(out)) {
    if (!m.name) { delete out[id]; continue; }
    for (const k of ['needs', 'paths']) m[k] = (m[k] || '').split(/\s+/).filter(Boolean);
  }
  return out;
}

/** The ids built: chosen and present, minus any whose needs aren't. */
export function resolveModules(manifest, root, chosenEnv = process.env.TUBCAL_MODULES) {
  const chosen = chosenEnv == null
    ? Object.keys(manifest)
    : chosenEnv.split(/[\s,]+/).filter((id) => manifest[id]);
  const present = (m) => m.paths
    .filter((p) => p.startsWith('frontend/'))
    .every((p) => fs.existsSync(path.join(root, p)));
  const on = new Set(chosen.filter((id) => present(manifest[id])));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...on]) {
      if (manifest[id].needs.some((n) => !on.has(n))) { on.delete(id); changed = true; }
    }
  }
  return Object.keys(manifest).filter((id) => on.has(id));
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `chosen`: a comma list in place of TUBCAL_MODULES (the phone app's build
 *  passes every room the phone can have, then splits them up: phone/rooms.mjs;
 *  `null` builds them all). */
export default function modules({ root = REPO, chosen = process.env.TUBCAL_MODULES } = {}) {
  const file = path.join(root, 'modules.ini');
  const manifest = fs.existsSync(file) ? readManifest(file) : {};
  const known = Object.keys(manifest);
  const on = resolveModules(manifest, root, chosen);
  const off = known.filter((id) => !on.includes(id));

  // owned path (relative to the repo, '/' separated) → module id, for the off ones
  const owned = [];
  for (const id of off) for (const p of manifest[id].paths) owned.push([p, id]);
  const ownerOf = (abs) => {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const hit = owned.find(([p]) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
    return hit ? hit[1] : null;
  };

  return {
    name: 'tubcal-modules',
    enforce: 'pre',
    config() {
      return { define: { __TUBCAL_MODULES__: JSON.stringify({ known, on }) } };
    },
    buildStart() {
      if (off.length) this.info(`left out: ${off.map((id) => manifest[id].name).join(', ')}`);
    },
    resolveId(source, importer) {
      if (!off.length || !importer || !source.startsWith('.')) return null;
      const abs = path.resolve(path.dirname(importer.split('?')[0]), source.split('?')[0]);
      const id = ownerOf(abs);
      return id ? `${ABSENT}${id}` : null; // one empty chunk per left-out module
    },
    load(id) {
      if (!id.startsWith(ABSENT)) return null;
      // Rendered only if a guard is missing; the module isn't in this build.
      return 'export default function Absent() { return null; }\n';
    },
  };
}
