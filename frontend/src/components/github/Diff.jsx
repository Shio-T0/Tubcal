// What a commit or a pull request changed: an index of the files, then each
// file's patch with old and new line numbers, folded when it's long.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileCode } from 'lucide-react';

import { scrollMotion } from '../../lib/motion.js';
import { DiffStat } from './bits.jsx';
import { codePath } from '../../lib/gh.js';
import g from './gh.module.css';

/** A unified-diff patch as rows: {type: hunk|add|del|ctx|note, old, new, text}. */
export function parsePatch(patch) {
  const rows = [];
  let o = 0;
  let n = 0;
  for (const line of (patch || '').split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (m) {
      o = Number(m[1]);
      n = Number(m[2]);
      rows.push({ type: 'hunk', text: line });
      continue;
    }
    if (line.startsWith('+')) rows.push({ type: 'add', new: n++, text: line.slice(1) });
    else if (line.startsWith('-')) rows.push({ type: 'del', old: o++, text: line.slice(1) });
    else if (line.startsWith('\\')) rows.push({ type: 'note', text: line.slice(2) });
    else rows.push({ type: 'ctx', old: o++, new: n++, text: line.slice(1) });
  }
  return rows;
}

const STATUS = { added: 'Added', removed: 'Deleted', modified: 'Changed', renamed: 'Renamed', copied: 'Copied', changed: 'Changed' };

function FilePatch({ file, repo, refName, open, onToggle, id }) {
  const rows = useMemo(() => (open ? parsePatch(file.patch) : []), [open, file.patch]);
  return (
    <section className={g.dfile} id={id}>
      <header className={g.dfileHead}>
        <button type="button" className={g.dfold} onClick={onToggle} aria-expanded={open} aria-label={open ? 'Fold' : 'Unfold'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className={`${g.dstatus} ${g[`ds_${file.status}`] || ''}`}>{STATUS[file.status] || file.status}</span>
        <span className={g.dpath}>
          {file.previous && file.previous !== file.name && <><s>{file.previous}</s> → </>}
          {file.name}
        </span>
        <DiffStat add={file.additions} del={file.deletions} />
        {repo && file.status !== 'removed' && (
          <Link className={g.dview} to={codePath(repo, file.name, refName)} title="View the file at this version">
            <FileCode size={13} />
          </Link>
        )}
      </header>
      {open && (file.patch ? (
        <div className={g.dtable} role="table" aria-label={`Changes to ${file.name}`}>
          {rows.map((r, i) => (
            r.type === 'hunk' ? (
              <div key={i} className={g.dhunk} role="row">{r.text}</div>
            ) : r.type === 'note' ? (
              <div key={i} className={g.dnote} role="row">{r.text}</div>
            ) : (
              <div key={i} className={`${g.drow} ${g[`d_${r.type}`]}`} role="row">
                <span className={g.dno}>{r.old ?? ''}</span>
                <span className={g.dno}>{r.new ?? ''}</span>
                <span className={g.dsign} aria-hidden="true">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
                <span className={g.dsrc}>{r.text || '​'}</span>
              </div>
            )
          ))}
        </div>
      ) : (
        <p className={g.dnone}>{file.patch_cut ? 'This change is too large to show here.' : 'No text changes (a binary file, or only renamed).'}</p>
      ))}
    </section>
  );
}

export default function DiffView({ files, repo, refName }) {
  const big = files.length > 25;
  const [open, setOpen] = useState(() => new Set(files.map((f, i) => (!big || i < 10) && (f.additions + f.deletions) < 800 ? f.name : null).filter(Boolean)));
  const toggle = (name) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  const add = files.reduce((a, f) => a + f.additions, 0);
  const del = files.reduce((a, f) => a + f.deletions, 0);
  const jump = (name, i) => {
    setOpen((s) => new Set(s).add(name));
    requestAnimationFrame(() => document.getElementById(`df-${i}`)?.scrollIntoView({ behavior: scrollMotion(), block: 'start' }));
  };

  return (
    <div className={g.diff}>
      <div className={g.dindex}>
        <div className={g.dindexHead}>
          <b>{files.length} file{files.length === 1 ? '' : 's'} changed</b>
          <DiffStat add={add} del={del} />
          <button type="button" onClick={() => setOpen(open.size ? new Set() : new Set(files.map((f) => f.name)))}>
            {open.size ? 'Fold all' : 'Unfold all'}
          </button>
        </div>
        <ul>
          {files.map((f, i) => (
            <li key={f.name}>
              <button type="button" onClick={() => jump(f.name, i)}>
                <span className={`${g.ddot} ${g[`ds_${f.status}`] || ''}`} aria-hidden="true" />
                <span className={g.dpath}>{f.name}</span>
                <DiffStat add={f.additions} del={f.deletions} words={false} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {files.map((f, i) => (
        <FilePatch key={f.name} id={`df-${i}`} file={f} repo={repo} refName={refName} open={open.has(f.name)} onToggle={() => toggle(f.name)} />
      ))}
    </div>
  );
}
