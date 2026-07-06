// The integrated terminal, dressed as the wood-cabinet CRT: xterm.js over the
// backend PTY socket, ANSI palette rebuilt from the design tokens on every
// theme switch so the shell reskins with the rest of the set.

import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import s from './editor.module.css';

const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

// ANSI ramp from the tokens; blue/magenta/cyan have no house dye, so they get
// fixed warm-leaning values that sit quietly next to any skin.
function buildTheme() {
  const paper = cssVar('--paper', '#e8d9b8');
  const faint = cssVar('--paper-faint', '#897053');
  const signal = cssVar('--signal', '#e6ab5e');
  return {
    background: '#00000000',
    foreground: paper,
    cursor: signal,
    cursorAccent: cssVar('--ink', '#1c140d'),
    selectionBackground: signal + '44',
    black: cssVar('--ink-3', '#302114'),
    red: cssVar('--danger', '#c75a44'),
    green: cssVar('--success', '#9aae64'),
    yellow: signal,
    blue: '#8fa1c9',
    magenta: '#c095a8',
    cyan: '#8fbcb0',
    white: paper,
    brightBlack: faint,
    brightRed: cssVar('--danger', '#c75a44'),
    brightGreen: cssVar('--success', '#9aae64'),
    brightYellow: signal,
    brightBlue: '#a9bbe0',
    brightMagenta: '#d4afc2',
    brightCyan: '#a8d4c8',
    brightWhite: paper,
  };
}

const wsBase = () => `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

export default function TerminalPanel({ cwd = '', registerWriter, visible }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const [state, setState] = useState('connecting'); // connecting | up | lost

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const term = new XTerm({
      fontFamily: cssVar('--font-code', 'monospace'),
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      theme: buildTheme(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(`${wsBase()}/api/editor/pty?cwd=${encodeURIComponent(cwd)}`);
    wsRef.current = ws;
    ws.onopen = () => {
      setState('up');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (ev) => term.write(ev.data);
    ws.onclose = () => setState('lost');
    ws.onerror = () => setState('lost');

    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    // reskin live when the app theme changes
    const observer = new MutationObserver(() => {
      term.options.theme = buildTheme();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const onWinResize = () => fit.fit();
    window.addEventListener('resize', onWinResize);
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(host);

    registerWriter?.((text) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: text }));
    });

    return () => {
      observer.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
      dataSub.dispose();
      resizeSub.dispose();
      registerWriter?.(null);
      try { ws.close(); } catch { /* already down */ }
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [visible]);

  return (
    <div className={s.termWrap}>
      {state === 'connecting' && <div className={s.termStatus}>receiving signal<span className={s.blinkBlock}>▮</span></div>}
      {state === 'lost' && <div className={s.termLost}>signal lost — shell closed</div>}
      <div ref={hostRef} className={s.termHost} />
    </div>
  );
}
