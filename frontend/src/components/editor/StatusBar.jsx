// The galley line: vim mode as an on-air light, path, git branch, diagnostics,
// tabular ln:col, filetype, LSP dot. All mono, all hairline-ruled.

import { GitBranch } from 'lucide-react';

import { languageName } from './cm/languages.js';
import s from './editor.module.css';

const MODE_CLASS = {
  normal: s.modeNormal,
  insert: s.modeInsert,
  visual: s.modeVisual,
  replace: s.modeInsert,
};

export default function StatusBar({ mode, subMode, path, dirty, cursor, branch, diagCount, lsp }) {
  const modeLabel = subMode ? `${mode} ${subMode}`.trim() : mode || 'normal';
  return (
    <div className={s.statusBar}>
      <span className={`${s.modeBadge} ${MODE_CLASS[mode] || s.modeNormal}`}>
        <span className={s.modeDot} />
        {modeLabel}
      </span>
      {path && (
        <span className={s.statusPath} title={path}>
          {path}
          {dirty && <span className={s.tombstone}>◼</span>}
        </span>
      )}
      {branch && (
        <span className={s.statusItem}>
          <GitBranch size={11} />
          {branch}
        </span>
      )}
      {diagCount > 0 && <span className={`${s.statusItem} ${s.statusDiag}`}>{diagCount} ⚠</span>}
      <span className={s.statusSpacer} />
      {cursor && (
        <span className={`${s.statusItem} ${s.statusNums}`}>
          ln {cursor.line}, col {cursor.col}
        </span>
      )}
      {path && <span className={s.statusItem}>{languageName(path.split('/').pop()).toLowerCase()}</span>}
      <span className={s.statusItem}>utf-8</span>
      {lsp && (
        <span className={s.statusItem} title={`language server: ${lsp}`}>
          <span className={s.lspDot} />
          lsp
        </span>
      )}
    </div>
  );
}
