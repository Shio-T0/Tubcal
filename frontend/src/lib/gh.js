// The GitHub room's plumbing: where things live in the app, how a github.com link
// becomes an in-app one, the colour each language wears, and the linked account.
//
//   /github                         the room (?v= view, ?q= search)
//   /github/r/:owner/:repo          a repository (?t= tab; code: ?path=&ref=)
//   /github/r/:owner/:repo/issues/:n, …/pull/:n   a thread (?tab=files for a PR)
//   /github/r/:owner/:repo/commit/:sha            a commit
//   /github/u/:login                a person or an organisation

import { hasModule } from './modules.js';
import { useShared } from './useShared.js';

export const repoPath = (full, params) => {
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString() : '';
  return `/github/r/${full}${q ? `?${q}` : ''}`;
};
export const userPath = (login) => `/github/u/${login}`;
export const threadPath = (full, kind, n) => `/github/r/${full}/${kind === 'pull' ? 'pull' : 'issues'}/${n}`;
export const commitPath = (full, sha) => `/github/r/${full}/commit/${sha}`;
export const codePath = (full, path, ref) => repoPath(full, { t: 'code', path: path || null, ref: ref || null });

/** The in-app page for a GitHub feed item (repo, release, commit, issue, PR,
 *  person, event), or null when there isn't one. */
export function itemPath(item) {
  const x = item?.extra || {};
  const repo = x.repo || item?.source;
  switch (x.kind || x.type) {
    case 'repo': return item.source ? repoPath(item.source) : null;
    case 'release': return repo ? repoPath(repo, { t: 'releases' }) : null;
    case 'commit': return repo && x.sha ? commitPath(repo, x.sha) : null;
    case 'issue': case 'pull': return repo && x.number ? threadPath(repo, x.kind || x.type, x.number) : null;
    case 'ghuser': case 'user': return x.login || item.author ? userPath(x.login || item.author) : null;
    case 'code': return repo && x.path ? codePath(repo, x.path) : null;
    case 'event':
      if ((x.link === 'pull' || x.link === 'issue') && x.number && repo) return threadPath(repo, x.link, x.number);
      if (x.target) return repoPath(x.target);
      return repo ? repoPath(repo) : null;
    default: return null;
  }
}

// First path segments on github.com that are GitHub's own pages, not a person.
const RESERVED = new Set([
  'about', 'apps', 'blog', 'codespaces', 'collections', 'contact', 'copilot', 'customer-stories', 'enterprise',
  'events', 'explore', 'features', 'github-copilot', 'issues', 'join', 'login', 'logout', 'marketplace', 'new',
  'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'readme', 'resources', 'search', 'security',
  'settings', 'site', 'solutions', 'sponsors', 'team', 'topics', 'trending', 'users', 'watching', 'stars', 'dashboard',
]);

/** The in-app address for a github.com URL, or null to leave it external. */
export function ghRoute(href) {
  let u;
  try { u = new URL(href, 'https://github.com'); } catch { return null; }
  if (!/^(www\.)?github\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length || RESERVED.has(parts[0].toLowerCase())) return null;
  if (parts.length === 1) return /^[A-Za-z0-9-]+$/.test(parts[0]) ? userPath(parts[0]) : null;
  const [owner, rawName, kind, ...rest] = parts;
  const full = `${owner}/${rawName.replace(/\.git$/, '')}`;
  if (!kind) return repoPath(full);
  if ((kind === 'issues' || kind === 'pull') && /^\d+$/.test(rest[0] || '')) {
    const base = threadPath(full, kind === 'pull' ? 'pull' : 'issue', rest[0]);
    return rest[1] === 'files' ? `${base}?tab=files` : base;
  }
  if (kind === 'commit' && rest[0]) return commitPath(full, rest[0]);
  if ((kind === 'blob' || kind === 'tree') && rest[0]) return codePath(full, rest.slice(1).join('/'), rest[0]);
  const tabs = { issues: 'issues', pulls: 'pulls', releases: 'releases', commits: 'commits', graphs: 'people', tags: 'releases' };
  if (tabs[kind]) return repoPath(full, { t: tabs[kind] });
  return null;
}

/** A link inside a file's rendered Markdown, resolved against that file's folder. */
export function resolveRelative(href, dir) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return null;
  const [path] = href.split(/[?#]/);
  const stack = href.startsWith('/') ? [] : (dir ? dir.split('/') : []);
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

// ── language colours ─────────────────────────────────────────────────────────
// From GitHub's linguist, for the languages that turn up most. Anything else gets
// a stable colour from its name.
const LANG = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Rust: '#dea584', Go: '#00ADD8',
  Java: '#b07219', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600', Ruby: '#701516', PHP: '#4F5D95',
  Shell: '#89e051', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', HTML: '#e34c26', CSS: '#663399',
  SCSS: '#c6538c', Vue: '#41b883', Svelte: '#ff3e00', Lua: '#000080', Haskell: '#5e5086', Elixir: '#6e4a7e',
  Erlang: '#B83998', Clojure: '#db5855', Scala: '#c22d40', Zig: '#ec915c', Nix: '#7e7eff', OCaml: '#ef7a08',
  Julia: '#a270ba', R: '#198CE7', Perl: '#0298c3', 'Objective-C': '#438eff', 'Jupyter Notebook': '#DA5B0B',
  'Vim Script': '#199f4b', 'Emacs Lisp': '#c065db', Dockerfile: '#384d54', Makefile: '#427819', TeX: '#3D6117',
  Markdown: '#083fa1', MDX: '#fcb32c', Assembly: '#6E4C13', Fortran: '#4d41b1', Groovy: '#4298b8',
  PowerShell: '#012456', Solidity: '#AA6746', Nim: '#ffc200', Gleam: '#ffaff3', 'F#': '#b845fc', Elm: '#60B5CC',
  Astro: '#ff5a03', Typst: '#239dad', HCL: '#844FBA', CMake: '#DA3434', GLSL: '#5686a5', Odin: '#60AFFE',
  'Common Lisp': '#3fb68b', Scheme: '#1e4aec', Racket: '#3c5caa', D: '#ba595e', Crystal: '#000100',
  'V': '#4f87c4', Mojo: '#ff4c1f', Cuda: '#3A4E3A', Roff: '#ecdebe', Batchfile: '#C1F12E', Meson: '#007800',
  QML: '#44a51c', Jsonnet: '#0064bd', Starlark: '#76d275', WebAssembly: '#04133b', Haxe: '#df7900',
  'Visual Basic .NET': '#945db7', Smalltalk: '#596706', Prolog: '#74283c', MATLAB: '#e16737', Hack: '#878787',
  Raku: '#0000fb', CoffeeScript: '#244776', Pascal: '#E3F171', Ada: '#02f88c', Verilog: '#b2b7f8',
  VHDL: '#adb2cb', SystemVerilog: '#DAE1C2', Arduino: '#bd79d1', 'Protocol Buffer': '#3186b7', YAML: '#cb171e',
  JSON: '#292929', TOML: '#9c4221', Blade: '#f7523f', Twig: '#c1d026', Liquid: '#67b8de', Handlebars: '#f7931e',
};

const LANG_LOWER = Object.fromEntries(Object.entries(LANG).map(([k, v]) => [k.toLowerCase(), v]));

/** A language's own colour (linguist's), or one derived from its name. */
export function langColor(name) {
  if (!name) return null;
  const known = LANG[name] || LANG_LOWER[name.toLowerCase()];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 55%)`;
}

/** A lane colour for a repo: its language's when known, else one from its name. */
export function laneColor(repo, language) {
  if (language) return langColor(language);
  let h = 0;
  for (let i = 0; i < (repo || '').length; i += 1) h = (h * 33 + repo.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 58%)`;
}

/** Black or white text for a #rrggbb label background. */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1b1b1b' : '#ffffff';
}

// ── words ────────────────────────────────────────────────────────────────────

export const REASONS = {
  review_requested: 'review requested',
  mention: 'mentioned',
  team_mention: 'team mentioned',
  assign: 'assigned',
  author: 'you opened it',
  comment: 'you commented',
  state_change: 'state changed',
  subscribed: 'watching',
  manual: 'subscribed',
  ci_activity: 'workflow run',
  security_alert: 'security alert',
  invitation: 'invitation',
  approval_requested: 'approval requested',
  member_feature_requested: 'feature request',
  security_advice_credited: 'security credit',
};

export function bytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function shortDate(epoch) {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── the account ──────────────────────────────────────────────────────────────

/** The linked account (or {linked:false}), shared by every part of the room. */
export function useGhAccount() {
  const res = useShared(hasModule('github') ? '/github/account' : null, { maxAge: 60_000 });
  const me = res.data || null;
  return { me, linked: !!me?.linked, can: me?.can || {}, loading: res.loading, reload: res.reload };
}
