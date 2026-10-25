// A Vite plugin that splits the phone UI's build by room, so a room left off a
// phone has none of its code there (each room is a split APK of its own, made by
// android/tools/rooms.py).
//
// modules.ini says which files are a room's (`paths`, the phone's screens
// included). Rollup's chunk graph says which output files the core can reach and
// which only a room's screens can: a room starts wherever code imports() a file
// of that room. An output file reached only from one room goes into that room's
// folder (`out/<id>/web/…`), the rest stays in the build (the core APK's web
// assets), and out/rooms.json lists what went where. A file two rooms share is
// the core's, as on the desktop, unless one of them needs the other (the Archive
// and the Screening Room): then it's the needed one's.
//
// It fails the build when a room's file would land in the core or in another
// room: something reaches it without going through import() (the phone's seams
// are the desktop's: lib/modules.js's moduleLazy, or a route behind hasModule).

import fs from 'node:fs';
import path from 'node:path';

import { readManifest } from '../../frontend/src/build/modules.mjs';

/** `rooms`: the ids of the rooms the phone can have; `out`: where their files go. */
export default function rooms({ root, rooms: ids, out }) {
  const manifest = readManifest(path.join(root, 'modules.ini'));
  const owned = [];
  for (const id of Object.keys(manifest)) for (const p of manifest[id].paths) owned.push([p, id]);
  const ownerOf = (id) => {
    if (!id || id.startsWith('\0')) return null;
    const rel = path.relative(root, id.split('?')[0]).split(path.sep).join('/');
    const hit = owned.find(([p]) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
    return hit ? hit[1] : null;
  };
  const rel = (id) => path.relative(root, id.split('?')[0]).split(path.sep).join('/');
  const needs = (id, acc = new Set()) => {
    for (const n of manifest[id]?.needs || []) if (!acc.has(n)) { acc.add(n); needs(n, acc); }
    return acc;
  };
  // the one room every root in `from` is or needs; else the core's
  const placeOf = (from) => {
    if (from.has('core')) return 'core';
    const all = [...from];
    return all.find((r) => all.every((x) => x === r || needs(x).has(r))) || 'core';
  };
  let plan = {}; // output file → room id

  return {
    name: 'tubcal-rooms',
    apply: 'build',
    buildStart() {
      fs.rmSync(out, { recursive: true, force: true });
    },
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
      const byFile = Object.fromEntries(chunks.map((c) => [c.fileName, c]));
      const chunkOf = {};
      for (const c of chunks) for (const m of c.moduleIds) chunkOf[m] = c.fileName;

      // which roots reach each chunk: 'core' from the entry, a room from where
      // code import()s one of its files (followed module by module: the chunk
      // holding that file may have no entry of its own)
      const reach = new Map();
      const visit = (file, from) => {
        const c = byFile[file];
        if (!c) return;
        const seen = reach.get(file) || new Set();
        if (seen.has(from)) return;
        seen.add(from);
        reach.set(file, seen);
        for (const f of c.imports) visit(f, from);
        for (const m of c.moduleIds) {
          for (const d of this.getModuleInfo(m)?.dynamicallyImportedIds || []) {
            const room = ownerOf(d);
            visit(chunkOf[d], room && room !== from ? room : from);
          }
        }
      };
      for (const c of chunks) if (c.isEntry) visit(c.fileName, 'core');

      plan = {};
      const wanted = {}; // asset file → set of places that need it
      const want = (file, where) => { (wanted[file] ||= new Set()).add(where); };
      const problems = [];
      for (const c of chunks) {
        const from = reach.get(c.fileName) || new Set(['core']);
        const where = placeOf(from);
        for (const m of c.moduleIds) {
          const o = ownerOf(m);
          if (!o || o === where) continue;
          const whence = [...from].join(' and ');
          problems.push(!ids.includes(o)
            ? `${rel(m)} belongs to ${o}, which isn't in the phone app, but ${whence} bundles it`
            : `${rel(m)} belongs to ${o}, but ${whence} reaches it without import()`);
        }
        if (where !== 'core') plan[c.fileName] = where;
        const meta = c.viteMetadata || {};
        for (const f of meta.importedCss || []) want(f, where);
        for (const f of meta.importedAssets || []) want(f, where);
      }
      for (const [file, places] of Object.entries(wanted)) {
        const where = placeOf(places);
        if (where !== 'core') plan[file] = where;
      }
      if (problems.length) {
        this.error(`a room's file would end up outside its room's split APK:\n  ${problems.join('\n  ')}\n`
          + "Reach it through moduleLazy / import() (@pc/lib/modules.js), or behind a route that checks hasModule.");
      }
    },
    writeBundle(opts) {
      const dist = opts.dir;
      const byRoom = {};
      for (const [file, id] of Object.entries(plan)) {
        const to = path.join(out, id, 'web', file);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(dist, file), to);
        (byRoom[id] ||= []).push(file);
      }
      for (const id of ids) byRoom[id] ||= [];
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'rooms.json'), `${JSON.stringify(byRoom, null, 2)}\n`);
      const counts = Object.entries(byRoom).map(([id, files]) => `${id} ${files.length}`).join(', ');
      this.info(`split by room (files): ${counts}`);
    },
  };
}
