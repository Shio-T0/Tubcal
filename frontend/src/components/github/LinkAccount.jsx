// Linking a GitHub account: take the GitHub CLI's sign-in in one press (when gh
// is installed and signed in), or paste a personal access token. The token is
// checked against GitHub, kept in the local database, and never sent back to
// the page. Shown in Settings → Accounts and in the GitHub room.

import { useState } from 'react';
import { Check, ExternalLink, KeyRound, Terminal, X } from 'lucide-react';

import { api } from '../../api/client.js';
import { useToast } from '../../state.jsx';
import { Face } from './bits.jsx';
import g from './gh.module.css';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,notifications,user:follow,read:user&description=Tubcal';

const UNLOCKS = [
  ['notifications', 'Your inbox: read, mark done, mute'],
  ['star', 'Starring repositories'],
  ['comment', 'Commenting on issues and pull requests'],
  ['follow', 'Following people on GitHub'],
  ['private', 'Your private repositories'],
  ['code_search', 'Searching code'],
];

const SOURCE = {
  gh: 'through the GitHub CLI',
  token: 'with a personal access token',
  setting: 'with a token from an older setting',
  env: 'from TUBCAL_GITHUB_TOKEN',
};

function hintFor(cap, me) {
  if (cap === 'notifications' && me.can?.fine_grained) return 'needs a classic token or the CLI';
  if (cap === 'follow') return me.source === 'gh' ? 'run gh auth refresh -s user:follow, then link again' : 'needs the user:follow scope';
  if (cap === 'private') return 'needs the repo scope';
  return 'needs the repo scope';
}

export default function LinkAccount({ me, onChanged }) {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(null);
  const gh = me?.gh_cli || {};

  const run = async (what, body, method = 'POST') => {
    setBusy(what);
    try {
      const d = await api('/github/account', { method, body: body ? JSON.stringify(body) : undefined });
      toast(d.linked ? `GitHub linked as ${d.login}` : 'GitHub account unlinked', 'success');
      setToken('');
      onChanged?.(d);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (me?.linked) {
    const fixed = me.source === 'env' || me.source === 'setting';
    return (
      <div className={g.link}>
        <div className={g.linkWho}>
          <Face src={me.avatar} login={me.login} size={40} />
          <span>
            <b>{me.name || me.login}</b>
            <em>@{me.login}, linked {SOURCE[me.source] || ''}</em>
          </span>
        </div>
        <ul className={g.linkCaps}>
          {UNLOCKS.map(([cap, words]) => (
            <li key={cap} className={me.can?.[cap] ? g.capYes : g.capNo}>
              {me.can?.[cap] ? <Check size={13} /> : <X size={13} />}
              {words}
              {!me.can?.[cap] && <small>{hintFor(cap, me)}</small>}
            </li>
          ))}
        </ul>
        {me.scopes && <p className={g.linkNote}>Token scopes: {me.scopes.length ? me.scopes.join(', ') : 'none'}</p>}
        <div className={g.linkActs}>
          {me.source === 'gh' && (
            <button type="button" className={g.btnGhost} disabled={!!busy} onClick={() => run('gh', { method: 'gh' })}>
              <Terminal size={14} /> {busy === 'gh' ? 'Linking…' : 'Link again from gh'}
            </button>
          )}
          {!fixed && (
            <button type="button" className={g.btnDanger} disabled={!!busy} onClick={() => run('unlink', null, 'DELETE')}>
              {busy === 'unlink' ? 'Unlinking…' : 'Unlink'}
            </button>
          )}
          {fixed && <p className={g.linkNote}>Set outside Tubcal, so it can’t be unlinked here.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={g.link}>
      {me?.broken && <p className={g.linkWarn}>{me.error}</p>}
      {gh.installed && gh.logged_in && (
        <div className={g.linkWay}>
          <div>
            <b>Use the GitHub CLI’s sign-in</b>
            <span>gh is signed in{gh.login ? ` as ${gh.login}` : ''} on this machine. Tubcal keeps a copy of its token.</span>
          </div>
          <button type="button" className={g.btnSolid} disabled={!!busy} onClick={() => run('gh', { method: 'gh' })}>
            <Terminal size={14} /> {busy === 'gh' ? 'Linking…' : `Link${gh.login ? ` ${gh.login}` : ''}`}
          </button>
        </div>
      )}
      {gh.installed && !gh.logged_in && (
        <p className={g.linkNote}>The GitHub CLI is installed but not signed in. Run <code>gh auth login</code>, then come back to link it in one press.</p>
      )}
      <form className={g.linkWay} onSubmit={(e) => { e.preventDefault(); if (token.trim()) run('token', { token: token.trim() }); }}>
        <div>
          <b>Paste a personal access token</b>
          <span>
            A classic token with <code>repo</code>, <code>notifications</code> and <code>user:follow</code> unlocks everything.{' '}
            <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">Create one on GitHub <ExternalLink size={11} /></a>
          </span>
          <input
            className={g.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-label="GitHub token"
          />
        </div>
        <button type="submit" className={gh.logged_in ? g.btnGhost : g.btnSolid} disabled={!token.trim() || !!busy}>
          <KeyRound size={14} /> {busy === 'token' ? 'Checking…' : 'Link token'}
        </button>
      </form>
      <p className={g.linkNote}>
        Without an account the room still works: trending, search, repositories and people, and your follows here. GitHub
        allows 60 API requests an hour without a token and 5,000 with one.
      </p>
    </div>
  );
}
