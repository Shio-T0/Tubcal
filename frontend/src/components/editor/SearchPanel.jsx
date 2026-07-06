// Project search — "the morgue file": ripgrep through the backend, results
// grouped by file, every hit a jump target.

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { api } from '../../api/client.js';
import { useDebounced } from '../layout/Section.jsx';
import s from './editor.module.css';

export default function SearchPanel({ onJump }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 400);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const query = dq.trim();
    if (query.length < 2) {
      setResult(null);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    api(`/editor/search?q=${encodeURIComponent(query)}`)
      .then((d) => {
        if (alive) {
          setResult(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq]);

  const grouped = [];
  if (result) {
    let cur = null;
    for (const h of result.hits) {
      if (!cur || cur.path !== h.path) {
        cur = { path: h.path, hits: [] };
        grouped.push(cur);
      }
      cur.hits.push(h);
    }
  }

  return (
    <div className={s.tree}>
      <div className={s.treeHead}>
        <span className={s.paneKicker}>The Morgue</span>
      </div>
      <div className={s.searchRow}>
        <Search size={13} className={s.searchRowIcon} />
        <input
          ref={inputRef}
          className={s.treeInput}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="grep the workspace…"
          spellCheck={false}
        />
      </div>
      <div className={s.treeScroll}>
        {loading && <div className={s.treeLoading}>searching<span className={s.blinkBlock}>▮</span></div>}
        {error && <div className={s.treeError}>signal lost — {error}</div>}
        {result && !loading && result.hits.length === 0 && <div className={s.treeEmpty}>no clippings found.</div>}
        {grouped.map((g) => (
          <div key={g.path} className={s.searchGroup}>
            <div className={s.searchFile} title={g.path}>{g.path}</div>
            {g.hits.map((h, i) => (
              <button key={`${h.line}:${i}`} className={s.searchHit} onClick={() => onJump(h.path, h.line, h.col)}>
                <span className={s.searchLine}>{h.line}</span>
                <span className={s.searchText}>{h.text.trim()}</span>
              </button>
            ))}
          </div>
        ))}
        {result?.truncated && <div className={s.treeEmpty}>…capped — narrow the query.</div>}
      </div>
    </div>
  );
}
