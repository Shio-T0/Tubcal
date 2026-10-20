// A file from a repository, read-only, highlighted with the same grammars the
// Composing Room loads (lazily, one language at a time) and coloured by the
// skin through tok-* classes. Line numbers are links: #L12 (or #L12-L20) marks
// those lines and is kept in the address, so a copied link lands on them.

import { useEffect, useMemo, useRef, useState } from 'react';
import { classHighlighter, highlightCode } from '@lezer/highlight';

import { languageFor, languageName } from '../../lib/languages.js';
import { scrollMotion } from '../../lib/motion.js';
import g from './gh.module.css';

const MAX_HIGHLIGHT = 400_000;

function plain(text) {
  return text.replace(/\n$/, '').split('\n').map((l) => [[l, '']]);
}

function parseHash(hash) {
  const m = /^#L(\d+)(?:-L(\d+))?$/.exec(hash || '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2] || m[1]);
  return [Math.min(a, b), Math.max(a, b)];
}

export function useHighlighted(text, name) {
  const [lines, setLines] = useState(() => plain(text || ''));
  useEffect(() => {
    let alive = true;
    const src = text || '';
    setLines(plain(src));
    if (!src || src.length > MAX_HIGHLIGHT) return undefined;
    languageFor(name).then((support) => {
      if (!alive || !support) return;
      const tree = support.language.parser.parse(src);
      const out = [[]];
      highlightCode(src, tree, classHighlighter, (t, cls) => out[out.length - 1].push([t, cls]), () => out.push([]));
      if (out.length > 1 && out[out.length - 1].length === 0) out.pop();
      setLines(out);
    }).catch(() => {});
    return () => { alive = false; };
  }, [text, name]);
  return lines;
}

export default function CodeView({ text, name }) {
  const lines = useHighlighted(text, name);
  const [range, setRange] = useState(() => parseHash(window.location.hash));
  const root = useRef(null);
  const lang = useMemo(() => languageName(name || ''), [name]);

  useEffect(() => {
    const onHash = () => setRange(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Land on the marked lines once, when the file first draws.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !range || !root.current) return;
    const el = root.current.querySelector(`[data-line="${range[0]}"]`);
    if (el) {
      landed.current = true;
      el.scrollIntoView({ block: 'center', behavior: scrollMotion() });
    }
  }, [range, lines]);

  const pick = (n, e) => {
    e.preventDefault();
    const next = e.shiftKey && range ? [Math.min(range[0], n), Math.max(range[0], n)] : [n, n];
    const hash = next[0] === next[1] ? `#L${next[0]}` : `#L${next[0]}-L${next[1]}`;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
    setRange(next);
  };

  return (
    <div className={g.code} ref={root} data-lang={lang}>
      {lines.map((parts, i) => {
        const n = i + 1;
        const on = range && n >= range[0] && n <= range[1];
        return (
          <div key={n} className={on ? `${g.codeLine} ${g.codeOn}` : g.codeLine} data-line={n}>
            <a href={`#L${n}`} className={g.ln} onClick={(e) => pick(n, e)} aria-label={`Line ${n}`}>{n}</a>
            <span className={g.src}>
              {parts.length ? parts.map(([t, cls], j) => (cls ? <span key={j} className={cls}>{t}</span> : t)) : '​'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
