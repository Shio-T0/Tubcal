// One CodeMirror buffer. Vim-first: @replit/codemirror-vim runs in front of the
// standard keymaps, ex commands are wired to the room (":w" saves through the
// backend, ":vsp" splits, ":e" opens the finder), and the same file visible in
// two panes stays in lockstep via change-forwarding with a sync annotation.

import { useEffect, useRef } from 'react';
import { EditorState, Compartment, Annotation } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit,
} from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap, forEachDiagnostic } from '@codemirror/lint';
import { vim, Vim, getCM } from '@replit/codemirror-vim';

import { showaEditorTheme } from './cm/theme.js';
import { languageFor, lspLanguage } from './cm/languages.js';
import { gitGutter } from './cm/gitGutter.js';

// The room registers itself here on mount; every vim ex command and update
// listener reads through it, so cached EditorStates never go stale.
export const roomApiRef = { current: null };
const viewMeta = new WeakMap(); // view -> { paneId, path }
const syncAnno = Annotation.define();

const langCompartment = new Compartment();
const lspCompartment = new Compartment();
const numberCompartment = new Compartment();

const room = () => roomApiRef.current;
const meta = (cm) => viewMeta.get(cm.cm6);
const bang = (p) => !!(p && p.argString && p.argString.trim().startsWith('!'));

// ---- ex commands (module-level singletons; the vim runtime is global) ----
let exDefined = false;
function defineExCommands() {
  if (exDefined) return;
  exDefined = true;
  Vim.defineEx('write', 'w', (cm, p) => {
    const m = meta(cm);
    if (m) room()?.save(m.path, { force: bang(p) });
  });
  Vim.defineEx('quit', 'q', (cm, p) => {
    const m = meta(cm);
    if (m) room()?.closeTab(m.paneId, m.path, bang(p));
  });
  Vim.defineEx('wq', 'wq', async (cm, p) => {
    const m = meta(cm);
    if (!m) return;
    const okSave = await room()?.save(m.path, { force: bang(p) });
    if (okSave) room()?.closeTab(m.paneId, m.path);
  });
  Vim.defineEx('vsplit', 'vsp', (cm) => {
    const m = meta(cm);
    if (m) room()?.vsplit(m.paneId);
  });
  Vim.defineEx('split', 'sp', (cm) => {
    const m = meta(cm);
    if (m) room()?.vsplit(m.paneId); // one axis only — sp behaves as vsp
  });
  Vim.defineEx('edit', 'e', (cm, p) => {
    const arg = p && p.args && p.args.length ? p.args[0] : null;
    if (arg) room()?.openFile(arg);
    else room()?.openFinder();
  });
  Vim.defineEx('terminal', 'term', () => room()?.toggleTerminal());
  Vim.defineEx('tcleader', 'tcleader', (cm) => {
    const m = meta(cm);
    if (m) room()?.openWhichKey(m.paneId);
  });
}

let leaderMapped = null;
export function mapLeader(leader) {
  const key = leader === ' ' || !leader ? '<Space>' : leader;
  if (leaderMapped === key) return;
  leaderMapped = key;
  Vim.map(key, ':tcleader', 'normal');
}

function guessIndent(name, content) {
  if (/\n\t/.test(content)) return '\t';
  if (/\.py[i]?$/.test(name)) return '    ';
  const m = content.match(/\n( +)\S/);
  return m && m[1].length >= 4 ? '    ' : '  ';
}

function relativeNumbers(relative) {
  return lineNumbers(
    relative
      ? {
          formatNumber: (n, s) => {
            const cur = s.doc.lineAt(s.selection.main.head).number;
            return n === cur ? String(n) : String(Math.abs(n - cur));
          },
        }
      : {},
  );
}

function buildExtensions({ name, content, relative }) {
  return [
    vim(), // must come before other keymaps so modal keys win
    numberCompartment.of(relativeNumbers(relative)),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    indentUnit.of(guessIndent(name, content)),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightSelectionMatches(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    gitGutter(),
    langCompartment.of([]),
    lspCompartment.of([]),
    keymap.of([
      {
        key: 'Mod-s',
        run: (view) => {
          const m = viewMeta.get(view);
          if (m) room()?.save(m.path, {});
          return true;
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    showaEditorTheme(),
    EditorView.updateListener.of((update) => {
      const m = viewMeta.get(update.view);
      const r = room();
      if (!m || !r) return;
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(syncAnno))) {
        r.onDocChange(m.path, update.view.state.doc.toString());
        // keep any twin view of the same file in lockstep
        for (const twin of r.viewsOf(m.path)) {
          if (twin !== update.view) {
            twin.dispatch({ changes: update.changes, annotations: syncAnno.of(true) });
          }
        }
        if (r.autosaveTick) r.autosaveTick(m.path);
      }
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        r.setCursor(m.paneId, { line: line.number, col: head - line.from + 1 });
      }
      if (update.focusChanged && update.view.hasFocus) r.setFocusedPane(m.paneId);
      if (update.docChanged) {
        let count = 0;
        forEachDiagnostic(update.state, () => count++);
        r.setDiagCount(m.paneId, count);
      }
    }),
  ];
}

export default function EditorPane({ paneId, path, focused }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);

  useEffect(() => {
    const r = room();
    const host = hostRef.current;
    if (!r || !host) return undefined;
    defineExCommands();
    mapLeader(r.leader);

    const buf = r.getBuffer(path);
    if (!buf) return undefined;
    const name = path.split('/').pop();

    const cached = r.stateCache.get(path);
    const state =
      cached ||
      EditorState.create({
        doc: buf.content,
        extensions: buildExtensions({ name, content: buf.content, relative: r.relativeLines }),
      });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    viewMeta.set(view, { paneId, path });
    r.registerView(path, view);

    // vim mode surface — the status bar's on-air light
    const cm = getCM(view);
    const onMode = (e) => r.setMode(paneId, e.mode, e.subMode || '');
    cm.on('vim-mode-change', onMode);
    r.setMode(paneId, 'normal', '');

    // async: language grammar, then LSP over the socket bridge
    let dead = false;
    languageFor(name).then((lang) => {
      if (!dead && lang) view.dispatch({ effects: langCompartment.reconfigure(lang) });
    });
    const lspLang = lspLanguage(name);
    if (lspLang && r.lspAvailable(lspLang)) {
      r.attachLsp(view, lspCompartment, lspLang, path, paneId);
    }
    r.refreshGitMarks(path, view);

    return () => {
      dead = true;
      cm.off('vim-mode-change', onMode);
      // cache the full state — undo history and cursor survive tab switches
      r.stateCache.set(path, view.state);
      r.unregisterView(path, view);
      viewMeta.delete(view);
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [paneId, path]);

  useEffect(() => {
    if (focused) viewRef.current?.focus();
  }, [focused, path]);

  return <div ref={hostRef} style={{ height: '100%', minWidth: 0 }} data-editor-pane={paneId} />;
}
