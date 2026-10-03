// Build-time only (Node), never imported by the app. It lives under src/ so the
// phone build gets it along with the rest of the desktop sources
// (Tubcal-Android/tools/sync-from-pc.sh copies frontend/src/ to phone/src/pc/).
//
// legal({ files }) is a Vite plugin that, on `vite build`, writes into the output:
//
//   legal/third-party-licenses.txt   every npm package that actually ended up in the
//                                    bundle, with its version, licence, source and
//                                    the licence/notice files it ships. The MIT,
//                                    ISC, BSD and Apache licences all ask for that
//                                    text to travel with the copies; a minified
//                                    bundle drops it, so this file carries it.
//   legal/<name>                     each entry of `files` copied as-is: the
//                                    project's own LICENSE and THIRD_PARTY_NOTICES.
//
// Settings → About shows all three from /legal/.

import fs from 'node:fs';
import path from 'node:path';

const NOTICE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;

/** A module id inside node_modules → that package's root and name. */
function packageOf(id) {
  const clean = id.replace(/^\0/, '').split('?')[0];
  const at = clean.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const parts = clean.slice(at + '/node_modules/'.length).split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  return { root: `${clean.slice(0, at)}/node_modules/${name}`, name };
}

function licenceOf(meta) {
  if (typeof meta.license === 'string') return meta.license;
  if (meta.license?.type) return meta.license.type;
  if (Array.isArray(meta.licenses)) return meta.licenses.map((l) => l.type || l).join(' OR ');
  return 'UNKNOWN';
}

function sourceOf(meta) {
  const r = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url;
  return (r || meta.homepage || '').replace(/^git\+/, '').replace(/\.git$/, '');
}

function describe(root, fallbackName) {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { /* none */ }
  const texts = [];
  try {
    for (const f of fs.readdirSync(root).sort()) {
      if (NOTICE_FILE.test(f) && fs.statSync(path.join(root, f)).isFile()) {
        texts.push(fs.readFileSync(path.join(root, f), 'utf8').trim());
      }
    }
  } catch { /* unreadable: listed without text */ }
  return {
    name: meta.name || fallbackName,
    version: meta.version || '',
    licence: licenceOf(meta),
    source: sourceOf(meta),
    texts,
  };
}

export default function legal({ title = 'Tubcal', files = {} } = {}) {
  return {
    name: 'tubcal-legal',
    apply: 'build',
    generateBundle() {
      const roots = new Map();
      for (const id of this.getModuleIds()) {
        const p = packageOf(id);
        if (p && !roots.has(p.root)) roots.set(p.root, p.name);
      }
      // One entry per name@version (a package can sit in more than one node_modules).
      const seen = new Map();
      for (const [root, name] of roots) {
        const d = describe(root, name);
        seen.set(`${d.name}@${d.version}`, d);
      }
      const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      const rule = '-'.repeat(78);
      const out = [
        `Third-party software bundled into the ${title} web app`,
        '',
        `${list.length} packages, generated at build time from the modules that ended up in`,
        'the bundle. Each one keeps its own licence, reproduced below as it ships.',
        '',
        ...list.map((d) => `  ${d.name} ${d.version} (${d.licence})`),
        '',
      ];
      for (const d of list) {
        out.push(rule, `${d.name} ${d.version}`, `Licence: ${d.licence}`);
        if (d.source) out.push(`Source: ${d.source}`);
        out.push('');
        out.push(d.texts.length ? d.texts.join('\n\n') : '(the package ships no licence file; its package.json declares the licence above)');
        out.push('');
      }
      this.emitFile({ type: 'asset', fileName: 'legal/third-party-licenses.txt', source: `${out.join('\n')}\n` });
      for (const [name, src] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `legal/${name}`, source: fs.readFileSync(src, 'utf8') });
      }
    },
  };
}
