// The explorer, styled as a table of contents: hairline-ruled nesting, dye dots
// for git status, quiet hover actions. Directories load lazily per expand.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, FilePlus2, FolderPlus, Pencil, RefreshCw, Trash2,
} from 'lucide-react';

import { api } from '../../api/client.js';
import s from './editor.module.css';

function GitDot({ status }) {
  if (!status) return null;
  const cls = status === '??' || status === 'A' ? s.gitDotAdd : s.gitDotMod;
  return <span className={`${s.gitDot} ${cls}`} title={status === '??' ? 'untracked' : 'modified'} />;
}

export default function FileTree({ onOpen, activePath, gitMap, refreshKey, onMutate }) {
  const [dirs, setDirs] = useState({}); // relPath -> entries
  const [expanded, setExpanded] = useState(() => new Set(['']));
  const [editing, setEditing] = useState(null); // {mode:'newfile'|'newdir'|'rename', dir, path?}
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async (path) => {
    try {
      const d = await api(`/editor/tree?path=${encodeURIComponent(path)}`);
      setDirs((prev) => ({ ...prev, [path]: d.entries }));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    for (const p of expanded) load(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 0);
  }, [editing]);

  const toggle = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!dirs[path]) load(path);
      }
      return next;
    });
  };

  const submitEdit = async (value) => {
    const v = value.trim();
    const ed = editing;
    setEditing(null);
    if (!v || !ed) return;
    try {
      if (ed.mode === 'newfile') {
        await api('/editor/file', { method: 'POST', body: JSON.stringify({ path: `${ed.dir ? ed.dir + '/' : ''}${v}`, content: '' }) });
      } else if (ed.mode === 'newdir') {
        await api('/editor/mkdir', { method: 'POST', body: JSON.stringify({ path: `${ed.dir ? ed.dir + '/' : ''}${v}` }) });
      } else if (ed.mode === 'rename') {
        const parent = ed.path.includes('/') ? ed.path.slice(0, ed.path.lastIndexOf('/')) : '';
        await api('/editor/rename', { method: 'POST', body: JSON.stringify({ path: ed.path, to: `${parent ? parent + '/' : ''}${v}` }) });
      }
      await load(ed.dir ?? '');
      onMutate?.();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm(`Strike ${entry.name} from the galley?`)) return;
    try {
      await api('/editor/delete', { method: 'POST', body: JSON.stringify({ path: entry.path }) });
      const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      await load(parent);
      onMutate?.();
    } catch (e) {
      setError(e.message);
    }
  };

  const editRow = (dir) => (
    <div className={s.treeEditRow} style={{ paddingLeft: 10 }}>
      <input
        ref={inputRef}
        className={s.treeInput}
        placeholder={editing.mode === 'newdir' ? 'folder name' : 'file name'}
        defaultValue={editing.mode === 'rename' ? editing.path.split('/').pop() : ''}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submitEdit(e.target.value);
          if (e.key === 'Escape') setEditing(null);
        }}
        onBlur={() => setEditing(null)}
        spellCheck={false}
      />
    </div>
  );

  const renderDir = (path, depth) => {
    const entries = dirs[path];
    if (!entries) return <div className={s.treeLoading} style={{ paddingLeft: depth * 14 + 24 }}>…</div>;
    return (
      <>
        {editing && editing.dir === path && editing.mode !== 'rename' && editRow(path)}
        {entries.map((e) => {
          const isOpen = expanded.has(e.path);
          if (editing && editing.mode === 'rename' && editing.path === e.path) return editRow(path);
          return (
            <div key={e.path}>
              <div
                className={`${s.treeRow} ${activePath === e.path ? s.treeRowActive : ''}`}
                style={{ paddingLeft: depth * 14 + 8 }}
              >
                <button
                  className={s.treeLabel}
                  onClick={() => (e.type === 'dir' ? toggle(e.path) : onOpen(e.path))}
                  onDoubleClick={() => e.type === 'dir' && toggle(e.path)}
                  title={e.path}
                >
                  {e.type === 'dir' ? (
                    isOpen ? <ChevronDown size={13} className={s.treeChev} /> : <ChevronRight size={13} className={s.treeChev} />
                  ) : (
                    <span className={s.treeFileTick} />
                  )}
                  <span className={s.treeName}>{e.name}</span>
                  <GitDot status={gitMap?.[e.path]} />
                </button>
                <span className={s.treeActions}>
                  {e.type === 'dir' && (
                    <>
                      <button className={s.treeAct} title="New file" onClick={() => { if (!isOpen) toggle(e.path); setEditing({ mode: 'newfile', dir: e.path }); }}>
                        <FilePlus2 size={12} />
                      </button>
                      <button className={s.treeAct} title="New folder" onClick={() => { if (!isOpen) toggle(e.path); setEditing({ mode: 'newdir', dir: e.path }); }}>
                        <FolderPlus size={12} />
                      </button>
                    </>
                  )}
                  <button className={s.treeAct} title="Rename" onClick={() => setEditing({ mode: 'rename', dir: path, path: e.path })}>
                    <Pencil size={12} />
                  </button>
                  <button className={s.treeAct} title="Delete" onClick={() => remove(e)}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              {e.type === 'dir' && isOpen && renderDir(e.path, depth + 1)}
            </div>
          );
        })}
        {entries.length === 0 && <div className={s.treeEmpty} style={{ paddingLeft: depth * 14 + 24 }}>empty galley</div>}
      </>
    );
  };

  return (
    <div className={s.tree}>
      <div className={s.treeHead}>
        <span className={s.paneKicker}>Index</span>
        <span className={s.treeActions} style={{ opacity: 1 }}>
          <button className={s.treeAct} title="New file" onClick={() => setEditing({ mode: 'newfile', dir: '' })}>
            <FilePlus2 size={13} />
          </button>
          <button className={s.treeAct} title="New folder" onClick={() => setEditing({ mode: 'newdir', dir: '' })}>
            <FolderPlus size={13} />
          </button>
          <button className={s.treeAct} title="Refresh" onClick={() => { for (const p of expanded) load(p); onMutate?.(); }}>
            <RefreshCw size={13} />
          </button>
        </span>
      </div>
      {error && <div className={s.treeError}>signal lost — {error}</div>}
      <div className={s.treeScroll}>{renderDir('', 0)}</div>
    </div>
  );
}
