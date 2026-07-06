// The Composing Room's conductor: buffers, panes, tabs, sidebar, terminal,
// overlays, git, LSP attachment, session persistence. Every vim ex command in
// EditorPane routes back through the roomApi assembled here.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { languageServer } from 'codemirror-languageserver';
import { FolderTree, Search, SquareTerminal, X } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { useSettings, useToast } from '../../state.jsx';
import EditorPane, { roomApiRef, mapLeader } from './EditorPane.jsx';
import FileTree from './FileTree.jsx';
import GoToFile from './GoToFile.jsx';
import SearchPanel from './SearchPanel.jsx';
import StatusBar from './StatusBar.jsx';
import WhichKey from './WhichKey.jsx';

// xterm.js only downloads when the terminal panel first opens
const TerminalPanel = lazy(() => import('./Terminal.jsx'));
import { runCommand } from './cm/languages.js';
import { setGitMarks } from './cm/gitGutter.js';
import s from './editor.module.css';

const wsBase = () => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
const norm = (p) => (p || '').replace(/^\.?\//, '');

export default function EditorRoom() {
  const status = useApi('/editor/status');
  const { settings } = useSettings();
  const toast = useToast();

  const [panes, setPanes] = useState([{ id: 0, tabs: [], active: null }]);
  const [focusedPane, setFocusedPane] = useState(0);
  const [sidebar, setSidebar] = useState('files'); // 'files' | 'search' | null
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);
  const [whichKeyOpen, setWhichKeyOpen] = useState(false);
  const [modes, setModes] = useState({});
  const [cursors, setCursors] = useState({});
  const [diags, setDiags] = useState({});
  const [lspByPane, setLspByPane] = useState({});
  const [dirtyMap, setDirtyMap] = useState({});
  const [git, setGit] = useState(null);
  const [treeRefresh, setTreeRefresh] = useState(0);
  const [sidebarW, setSidebarW] = useState(230);
  const [termH, setTermH] = useState(220);

  const buffers = useRef(new Map());     // path -> {content, savedContent, mtime}
  const stateCache = useRef(new Map());  // path -> EditorState
  const views = useRef(new Map());       // path -> Set<EditorView>
  const pendingJump = useRef(null);      // {path, line, col}
  const termWriter = useRef(null);
  const pendingCmd = useRef(null);
  const autosaveTimers = useRef(new Map());
  const rootRef = useRef(null);
  const nextPaneId = useRef(1);
  const restored = useRef(false);
  const sessionTimer = useRef(null);

  const statusData = status.data;
  const statusRef = useRef(null);
  statusRef.current = statusData;

  const focusedPaneObj = panes.find((p) => p.id === focusedPane) || panes[0];
  const activePath = focusedPaneObj?.active || null;

  // ---------- helpers ----------

  const viewsOf = useCallback((path) => views.current.get(path) || [], []);

  const jumpTo = useCallback((view, line, col) => {
    try {
      const l = view.state.doc.line(Math.min(line, view.state.doc.lines));
      const pos = Math.min(l.from + Math.max(0, (col || 1) - 1), l.to);
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
      view.focus();
    } catch { /* line out of range after edits */ }
  }, []);

  const focusActive = useCallback(() => {
    setTimeout(() => {
      const pane = panes.find((p) => p.id === focusedPane);
      if (!pane?.active) return;
      for (const v of views.current.get(pane.active) || []) v.focus();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes, focusedPane]);

  const fetchGit = useCallback(async (path) => {
    try {
      const d = await api(`/editor/git/status?path=${encodeURIComponent(path || '')}`);
      setGit(d.repo === null && !d.branch ? null : d);
    } catch { setGit(null); }
  }, []);

  const refreshGitMarks = useCallback(async (path, view) => {
    try {
      const d = await api(`/editor/git/diff?path=${encodeURIComponent(path)}`);
      const targets = view ? [view] : [...(views.current.get(path) || [])];
      for (const v of targets) v.dispatch({ effects: setGitMarks.of(d.marks) });
    } catch { /* no repo / no git */ }
  }, []);

  // ---------- buffer & pane operations ----------

  const openFile = useCallback(async (rawPath, opts = {}) => {
    const path = norm(rawPath);
    if (!path) return;
    if (!buffers.current.has(path)) {
      try {
        const d = await api(`/editor/file?path=${encodeURIComponent(path)}`);
        buffers.current.set(path, { content: d.content, savedContent: d.content, mtime: d.mtime });
      } catch (e) {
        toast(`can't open ${path} — ${e.message}`, 'error');
        return;
      }
    }
    if (opts.line) pendingJump.current = { path, line: opts.line, col: opts.col };
    setPanes((prev) => {
      const holder = prev.find((p) => p.tabs.includes(path));
      if (holder) {
        setFocusedPane(holder.id);
        if (pendingJump.current?.path === path) {
          const j = pendingJump.current;
          pendingJump.current = null;
          setTimeout(() => {
            for (const v of views.current.get(path) || []) jumpTo(v, j.line, j.col);
          }, 0);
        }
        return prev.map((p) => (p.id === holder.id ? { ...p, active: path } : p));
      }
      return prev.map((p) =>
        p.id === focusedPane ? { ...p, tabs: [...p.tabs, path], active: path } : p,
      );
    });
    fetchGit(path);
  }, [focusedPane, toast, jumpTo, fetchGit]);

  const save = useCallback(async (path, { force } = {}) => {
    const buf = buffers.current.get(path);
    if (!buf) return false;
    try {
      const body = { path, content: buf.content };
      if (!force && buf.mtime != null) body.mtime = buf.mtime;
      const d = await api('/editor/file', { method: 'POST', body: JSON.stringify(body) });
      buf.mtime = d.mtime;
      buf.savedContent = buf.content;
      setDirtyMap((m) => ({ ...m, [path]: false }));
      refreshGitMarks(path);
      fetchGit(path);
      return true;
    } catch (e) {
      if (e.status === 409) toast('file changed on disk — :w! to overwrite', 'error');
      else toast(`write failed — ${e.message}`, 'error');
      return false;
    }
  }, [toast, refreshGitMarks, fetchGit]);

  const closeTab = useCallback((paneId, path, force = false) => {
    if (!path) return;
    const buf = buffers.current.get(path);
    if (buf && buf.content !== buf.savedContent && !force) {
      toast('unsaved changes — :q! to discard, :wq to keep', 'error');
      return;
    }
    setPanes((prev) => {
      let next = prev.map((p) => {
        if (p.id !== paneId) return p;
        const tabs = p.tabs.filter((t) => t !== path);
        const active = p.active === path ? tabs[Math.max(0, p.tabs.indexOf(path) - 1)] || tabs[0] || null : p.active;
        return { ...p, tabs, active };
      });
      const emptied = next.find((p) => p.id === paneId && p.tabs.length === 0);
      if (emptied && next.length > 1) {
        next = next.filter((p) => p.id !== paneId);
        setFocusedPane(next[0].id);
      }
      const stillOpen = next.some((p) => p.tabs.includes(path));
      if (!stillOpen) {
        buffers.current.delete(path);
        stateCache.current.delete(path);
      }
      return next;
    });
  }, [toast]);

  const vsplit = useCallback((paneId) => {
    setPanes((prev) => {
      if (prev.length >= 2) {
        const other = prev.find((p) => p.id !== paneId);
        if (other) setFocusedPane(other.id);
        return prev;
      }
      const src = prev.find((p) => p.id === paneId);
      if (!src?.active) return prev;
      const id = nextPaneId.current++;
      setFocusedPane(id);
      return [...prev, { id, tabs: [src.active], active: src.active }];
    });
  }, []);

  const toggleTerminal = useCallback(() => setTerminalOpen((v) => !v), []);

  const runCurrent = useCallback(() => {
    const pane = panes.find((p) => p.id === focusedPane);
    if (!pane?.active) return;
    const cmd = runCommand(pane.active);
    if (!cmd) {
      toast('no press run for this filetype', 'error');
      return;
    }
    const line = `${cmd}\n`;
    if (termWriter.current) termWriter.current(line);
    else {
      pendingCmd.current = line;
      setTerminalOpen(true);
    }
  }, [panes, focusedPane, toast]);

  const registerWriter = useCallback((fn) => {
    termWriter.current = fn;
    if (fn && pendingCmd.current) {
      fn(pendingCmd.current);
      pendingCmd.current = null;
    }
  }, []);

  // ---------- the roomApi the panes talk to ----------

  useEffect(() => {
    roomApiRef.current = {
      leader: settings?.editor_leader ?? ' ',
      relativeLines: !!settings?.editor_relative_lines,
      stateCache: stateCache.current,
      getBuffer: (path) => buffers.current.get(path),
      viewsOf,
      registerView: (path, view) => {
        if (!views.current.has(path)) views.current.set(path, new Set());
        views.current.get(path).add(view);
        const j = pendingJump.current;
        if (j && j.path === path) {
          pendingJump.current = null;
          setTimeout(() => jumpTo(view, j.line, j.col), 0);
        }
      },
      unregisterView: (path, view) => {
        views.current.get(path)?.delete(view);
      },
      onDocChange: (path, content) => {
        const buf = buffers.current.get(path);
        if (!buf) return;
        buf.content = content;
        const dirty = content !== buf.savedContent;
        setDirtyMap((m) => (m[path] === dirty ? m : { ...m, [path]: dirty }));
      },
      autosaveTick: settings?.editor_autosave
        ? (path) => {
            clearTimeout(autosaveTimers.current.get(path));
            autosaveTimers.current.set(path, setTimeout(() => save(path, {}), 1400));
          }
        : null,
      save,
      closeTab,
      vsplit,
      openFile,
      openFinder: () => setFinderOpen(true),
      toggleTerminal,
      openWhichKey: () => setWhichKeyOpen(true),
      setMode: (paneId, mode, subMode) => setModes((m) => ({ ...m, [paneId]: { mode, subMode } })),
      setCursor: (paneId, cur) =>
        setCursors((m) => {
          const old = m[paneId];
          return old && old.line === cur.line && old.col === cur.col ? m : { ...m, [paneId]: cur };
        }),
      setDiagCount: (paneId, n) => setDiags((m) => (m[paneId] === n ? m : { ...m, [paneId]: n })),
      setFocusedPane: (paneId) => setFocusedPane(paneId),
      lspAvailable: (lang) =>
        !!(settings?.editor_lsp_enabled !== false && statusRef.current?.terminal && statusRef.current?.lsp?.[lang]),
      attachLsp: (view, compartment, lang, path, paneId) => {
        const root = statusRef.current?.root;
        if (!root) return;
        try {
          const ext = languageServer({
            serverUri: `${wsBase()}/api/editor/lsp?lang=${lang}`,
            rootUri: `file://${root}`,
            workspaceFolders: [{ name: 'workspace', uri: `file://${root}` }],
            documentUri: `file://${root}/${path}`,
            languageId: lang,
          });
          view.dispatch({ effects: compartment.reconfigure(ext) });
          setLspByPane((m) => ({ ...m, [paneId]: lang }));
        } catch { /* stays a plain buffer */ }
      },
      refreshGitMarks,
    };
  });

  useEffect(() => () => { roomApiRef.current = null; }, []);

  useEffect(() => {
    if (settings?.editor_leader != null) mapLeader(settings.editor_leader);
  }, [settings?.editor_leader]);

  // ---------- session restore / persist ----------

  useEffect(() => {
    if (restored.current || !statusData) return;
    restored.current = true;
    (async () => {
      try {
        const d = await api('/editor/state');
        const ses = d.session;
        if (!ses?.panes?.length) return;
        const loaded = [];
        for (const p of ses.panes) {
          const tabs = [];
          for (const t of p.tabs || []) {
            try {
              const f = await api(`/editor/file?path=${encodeURIComponent(t)}`);
              buffers.current.set(t, { content: f.content, savedContent: f.content, mtime: f.mtime });
              tabs.push(t);
            } catch { /* moved or deleted since */ }
          }
          if (tabs.length) {
            loaded.push({ id: nextPaneId.current++, tabs, active: tabs.includes(p.active) ? p.active : tabs[0] });
          }
        }
        if (loaded.length) {
          setPanes(loaded);
          setFocusedPane(loaded[0].id);
          if (ses.sidebar !== undefined) setSidebar(ses.sidebar);
          if (ses.terminalOpen) setTerminalOpen(true);
          if (ses.sidebarW) setSidebarW(ses.sidebarW);
          if (ses.termH) setTermH(ses.termH);
          if (loaded[0].active) fetchGit(loaded[0].active);
        }
      } catch { /* fresh galley */ }
    })();
  }, [statusData, fetchGit]);

  useEffect(() => {
    if (!restored.current) return;
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      api('/editor/state', {
        method: 'POST',
        body: JSON.stringify({
          session: {
            panes: panes.map((p) => ({ tabs: p.tabs, active: p.active })),
            sidebar, terminalOpen, sidebarW, termH,
          },
        }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(sessionTimer.current);
  }, [panes, sidebar, terminalOpen, sidebarW, termH]);

  // ---------- global stand-down while the room holds focus ----------

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onIn = () => { document.body.dataset.editorFocused = '1'; };
    const onOut = (e) => {
      if (!root.contains(e.relatedTarget)) delete document.body.dataset.editorFocused;
    };
    root.addEventListener('focusin', onIn);
    root.addEventListener('focusout', onOut);
    return () => {
      root.removeEventListener('focusin', onIn);
      root.removeEventListener('focusout', onOut);
      delete document.body.dataset.editorFocused;
    };
  }, []);

  // ---------- drag-resize (sidebar + terminal) ----------

  const startDrag = useCallback((e, kind) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseW = sidebarW;
    const baseH = termH;
    const move = (ev) => {
      if (kind === 'sidebar') setSidebarW(Math.min(480, Math.max(160, baseW + ev.clientX - startX)));
      else setTermH(Math.min(window.innerHeight * 0.6, Math.max(110, baseH - (ev.clientY - startY))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [sidebarW, termH]);

  // ---------- which-key dispatch ----------

  const runLeader = useCallback((key) => {
    setWhichKeyOpen(false);
    switch (key) {
      case 'f': setFinderOpen(true); break;
      case 's': setSidebar('search'); break;
      case 'e': setSidebar((v) => (v === 'files' ? null : 'files')); focusActive(); break;
      case 't': toggleTerminal(); break;
      case 'w': if (activePath) save(activePath, {}); focusActive(); break;
      case 'q': if (activePath) closeTab(focusedPane, activePath); focusActive(); break;
      case 'v': vsplit(focusedPane); break;
      case 'o': setPanes((prev) => { if (prev.length > 1) setFocusedPane(prev.find((p) => p.id !== focusedPane)?.id ?? focusedPane); return prev; }); break;
      case 'r': runCurrent(); break;
      case 'g': if (activePath) { fetchGit(activePath); refreshGitMarks(activePath); } focusActive(); break;
      default: focusActive();
    }
  }, [activePath, focusedPane, save, closeTab, vsplit, toggleTerminal, runCurrent, fetchGit, refreshGitMarks, focusActive]);

  // ---------- render ----------

  const gitMap = useMemo(() => {
    const m = {};
    for (const c of git?.changes || []) m[c.path] = c.status;
    return m;
  }, [git]);

  if (statusData && !statusData.root_exists) {
    return (
      <div className={s.roomError}>
        signal lost — workspace root <code>{statusData.root}</code> does not exist.
        Set <code>TUBCAL_EDITOR_ROOT</code> in .env and restart.
      </div>
    );
  }

  const paneMode = modes[focusedPane] || { mode: 'normal', subMode: '' };

  return (
    <div className={s.room} ref={rootRef}>
      <div className={s.workbench}>
        <div className={s.rail}>
          <button
            className={`${s.railBtn} ${sidebar === 'files' ? s.railBtnOn : ''}`}
            title="Index — <leader>e"
            onClick={() => setSidebar((v) => (v === 'files' ? null : 'files'))}
          >
            <FolderTree size={16} />
          </button>
          <button
            className={`${s.railBtn} ${sidebar === 'search' ? s.railBtnOn : ''}`}
            title="The Morgue — <leader>s"
            onClick={() => setSidebar((v) => (v === 'search' ? null : 'search'))}
          >
            <Search size={16} />
          </button>
          <div className={s.railSpacer} />
          <button
            className={`${s.railBtn} ${terminalOpen ? s.railBtnOn : ''}`}
            title="Terminal — <leader>t"
            onClick={toggleTerminal}
          >
            <SquareTerminal size={16} />
          </button>
        </div>

        {sidebar && (
          <>
            <div className={s.sidebar} style={{ width: sidebarW }}>
              {sidebar === 'files' ? (
                <FileTree
                  onOpen={(p) => openFile(p)}
                  activePath={activePath}
                  gitMap={gitMap}
                  refreshKey={treeRefresh}
                  onMutate={() => { setTreeRefresh((n) => n + 1); if (activePath) fetchGit(activePath); }}
                />
              ) : (
                <SearchPanel onJump={(p, line, col) => openFile(p, { line, col: (col || 0) + 1 })} />
              )}
            </div>
            <div className={s.vHandle} onPointerDown={(e) => startDrag(e, 'sidebar')} />
          </>
        )}

        <div className={s.main}>
          <div className={s.paneRow}>
            {panes.map((pane) => (
              <div
                key={pane.id}
                className={`${s.pane} ${panes.length > 1 && pane.id === focusedPane ? s.paneFocused : ''}`}
                onMouseDown={() => setFocusedPane(pane.id)}
              >
                <div className={s.tabStrip}>
                  {pane.tabs.map((t) => {
                    const name = t.split('/').pop();
                    return (
                      <button
                        key={t}
                        className={`${s.tab} ${pane.active === t ? s.tabActive : ''}`}
                        onClick={() => setPanes((prev) => prev.map((p) => (p.id === pane.id ? { ...p, active: t } : p)))}
                        onAuxClick={(e) => { if (e.button === 1) closeTab(pane.id, t); }}
                        title={t}
                      >
                        <span className={s.tabTick} />
                        <span className={s.tabName}>{name}</span>
                        {dirtyMap[t] ? (
                          <span className={s.tombstone}>◼</span>
                        ) : (
                          <span
                            className={s.tabClose}
                            role="button"
                            tabIndex={-1}
                            onClick={(e) => { e.stopPropagation(); closeTab(pane.id, t); }}
                          >
                            <X size={11} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className={s.paneBody}>
                  {pane.active ? (
                    <EditorPane paneId={pane.id} path={pane.active} focused={pane.id === focusedPane && !finderOpen && !whichKeyOpen} />
                  ) : (
                    <div className={s.emptyPane}>
                      <p className={s.emptyPaneTitle}>The galley is empty.</p>
                      <p className={s.emptyPaneHints}>
                        <kbd className={s.kbd}>space</kbd> <kbd className={s.kbd}>f</kbd> find file
                        <span className={s.hintSep}>·</span>
                        <kbd className={s.kbd}>:e</kbd> edit
                        <span className={s.hintSep}>·</span>
                        <kbd className={s.kbd}>space</kbd> <kbd className={s.kbd}>t</kbd> terminal
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {terminalOpen && (
            <>
              <div className={s.hHandle} onPointerDown={(e) => startDrag(e, 'term')} />
              <div className={s.termPanel} style={{ height: termH }}>
                <div className={s.termHead}>
                  <span className={s.paneKicker}>Terminal</span>
                  <button className={s.treeAct} title="Close terminal" onClick={toggleTerminal}>
                    <X size={13} />
                  </button>
                </div>
                <Suspense fallback={<div className={s.termStatus}>receiving signal<span className={s.blinkBlock}>▮</span></div>}>
                  <TerminalPanel registerWriter={registerWriter} visible={terminalOpen} />
                </Suspense>
              </div>
            </>
          )}

          <StatusBar
            mode={paneMode.mode}
            subMode={paneMode.subMode}
            path={activePath}
            dirty={!!dirtyMap[activePath]}
            cursor={cursors[focusedPane]}
            branch={git?.branch}
            diagCount={diags[focusedPane] || 0}
            lsp={lspByPane[focusedPane]}
          />
        </div>
      </div>

      {finderOpen && (
        <GoToFile
          onPick={(p) => { setFinderOpen(false); openFile(p); }}
          onClose={() => { setFinderOpen(false); focusActive(); }}
        />
      )}
      {whichKeyOpen && <WhichKey onRun={runLeader} onClose={() => { setWhichKeyOpen(false); focusActive(); }} />}
    </div>
  );
}
