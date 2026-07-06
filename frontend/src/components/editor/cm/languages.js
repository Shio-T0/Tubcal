// Language wiring: @codemirror/language-data lazily code-splits every grammar,
// so opening main.py only ever downloads the python package.

import { languages } from '@codemirror/language-data';

/** CodeMirror language support for a filename (async; null when unknown). */
export async function languageFor(name) {
  const desc =
    languages.find((l) => l.filename && l.filename.test(name)) ||
    languages.find((l) => l.extensions.includes(ext(name)));
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}

export function languageName(name) {
  const desc =
    languages.find((l) => l.filename && l.filename.test(name)) ||
    languages.find((l) => l.extensions.includes(ext(name)));
  return desc ? desc.name : 'Plain Text';
}

function ext(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

// LSP language ids — must match SERVERS in server/editor/lsp.py.
const LSP_BY_EXT = {
  py: 'python', pyi: 'python',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  rs: 'rust',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  go: 'go',
};

export function lspLanguage(name) {
  return LSP_BY_EXT[ext(name)] || null;
}

// How <leader>r runs a file, by extension. null → not runnable.
export function runCommand(relPath) {
  const e = ext(relPath);
  const q = `'${relPath.replace(/'/g, `'\\''`)}'`;
  switch (e) {
    case 'py': return `python3 ${q}`;
    case 'js': case 'mjs': case 'cjs': return `node ${q}`;
    case 'ts': return `npx tsx ${q}`;
    case 'sh': case 'bash': return `bash ${q}`;
    case 'rs': return `cargo run`;
    case 'go': return `go run ${q}`;
    case 'html': return `xdg-open ${q}`;
    default: return null;
  }
}
