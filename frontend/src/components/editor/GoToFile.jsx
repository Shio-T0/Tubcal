// Go-to-file finder — the command palette idiom scoped to the workspace.
// Fuzzy subsequence match with start-of-segment and consecutiveness bonuses.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, FileCode2 } from 'lucide-react';

import { api } from '../../api/client.js';
import s from './editor.module.css';

function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak += 1;
      score += 1 + streak * 2;
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '_' || t[ti - 1] === '-' || t[ti - 1] === '.') score += 8;
      qi += 1;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return -1;
  // shorter paths and basename hits read better
  score -= Math.floor(t.length / 8);
  const base = t.slice(t.lastIndexOf('/') + 1);
  if (base.includes(q)) score += 20;
  return score;
}

export default function GoToFile({ onPick, onClose }) {
  const [files, setFiles] = useState(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    api('/editor/files').then((d) => setFiles(d.files)).catch(() => setFiles([]));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const hits = useMemo(() => {
    if (!files) return [];
    if (!q.trim()) return files.slice(0, 40).map((f) => ({ path: f, score: 0 }));
    const out = [];
    for (const f of files) {
      const sc = fuzzyScore(q.trim(), f);
      if (sc >= 0) out.push({ path: f, score: sc });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 40);
  }, [files, q]);

  useEffect(() => setActive(0), [q]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hits[active]) onPick(hits[active].path);
    }
  };

  return (
    <div className={s.overlayBackdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.finder} role="dialog" aria-modal="true" aria-label="Go to file">
        <div className={s.finderInputRow}>
          <FileCode2 size={15} className={s.finderIcon} />
          <input
            ref={inputRef}
            className={s.finderInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Set a file…"
            spellCheck={false}
          />
          <kbd className={s.kbd}>esc</kbd>
        </div>
        <div className={s.finderList}>
          {files === null && <div className={s.finderEmpty}>reading the index…</div>}
          {files !== null && hits.length === 0 && <div className={s.finderEmpty}>nothing set under that name.</div>}
          {hits.map((h, i) => {
            const base = h.path.slice(h.path.lastIndexOf('/') + 1);
            const dir = h.path.slice(0, h.path.length - base.length);
            return (
              <button
                key={h.path}
                className={`${s.finderRow} ${i === active ? s.finderRowActive : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(h.path)}
              >
                <span className={s.finderBase}>{base}</span>
                {dir && <span className={s.finderDir}>{dir}</span>}
                {i === active && <CornerDownLeft size={12} className={s.finderEnter} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
