// The which-key leader menu — the bridge that keeps nvim hands discoverable.
// Opens on <leader> in normal mode; one more keypress runs the binding.

import { useEffect } from 'react';

import s from './editor.module.css';

export const LEADER_BINDINGS = [
  { key: 'f', label: 'find file' },
  { key: 's', label: 'search project' },
  { key: 'e', label: 'toggle index' },
  { key: 't', label: 'toggle terminal' },
  { key: 'w', label: 'write buffer' },
  { key: 'q', label: 'close buffer' },
  { key: 'v', label: 'split vertical' },
  { key: 'o', label: 'other pane' },
  { key: 'r', label: 'run file' },
  { key: 'g', label: 'refresh git' },
];

export default function WhichKey({ onRun, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return onClose();
      const hit = LEADER_BINDINGS.find((b) => b.key === e.key);
      if (hit) onRun(hit.key);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(onClose, 4000); // a menu, not a modal — it steps aside
    return () => {
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(t);
    };
  }, [onRun, onClose]);

  return (
    <div className={s.whichKey} role="menu" aria-label="Leader key bindings">
      <div className={s.whichKeyTitle}>
        <kbd className={s.kbd}>leader</kbd>
        <span className={s.whichKeyHint}>then…</span>
      </div>
      <div className={s.whichKeyGrid}>
        {LEADER_BINDINGS.map((b) => (
          <button key={b.key} className={s.whichKeyItem} onClick={() => onRun(b.key)}>
            <kbd className={s.kbd}>{b.key}</kbd>
            <span>{b.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
