// The one writing desk for every social box in the Anime: comments, replies,
// statuses, profile messages, new threads, reviews.
//
// Beside (or, in a tight spot, beneath) the text sits the post itself — your
// face, your name, "just now", and the words rendered the way everyone else will
// see them, spoilers veiled and all. It renders in the browser on every keystroke
// (markdown.js), and when typing pauses it quietly swaps in AniList's own render
// of the same text, so the last word on "how will this look" is AniList's.
//
// Keys: Ctrl/⌘+B bold, Ctrl/⌘+I italic, Ctrl/⌘+Enter posts, Esc cancels. Without
// an `onSubmit` it's a controlled field for a bigger form (the review composer).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Bold, Code, Eye, EyeOff, Heading, HelpCircle, Image, Italic, Link2, List, Loader2, Quote,
  AlignCenter, Send, Strikethrough, Youtube,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { aniMarkdown } from './markdown.js';
import { asPerson, PersonAvatar } from './Person.jsx';
import { AniHtml } from './RichText.jsx';
import m from './composer.module.css';

const PREVIEW_KEY = 'tubcal.anime.composer.preview';
const DRAFT_PREFIX = 'tubcal.anime.draft.';
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : v; } catch { return fallback; } },
  set(k, v) { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// AniList's render is one request against a 30-a-minute budget: ask only after a
// pause, and never more than once every few seconds from one box.
const EXACT_PAUSE = 1400;
const EXACT_MIN_GAP = 8000;

const TOOLS = [
  { id: 'bold', Icon: Bold, label: 'Bold (Ctrl+B)', wrap: ['__', '__', 'bold'] },
  { id: 'italic', Icon: Italic, label: 'Italic (Ctrl+I)', wrap: ['_', '_', 'italic'] },
  { id: 'strike', Icon: Strikethrough, label: 'Strikethrough', wrap: ['~~', '~~', 'struck'] },
  { id: 'spoiler', Icon: EyeOff, label: 'Spoiler — veiled until clicked', wrap: ['~!', '!~', 'the twist'] },
  { sep: true },
  { id: 'link', Icon: Link2, label: 'Link', wrap: ['[', '](https://)', 'text'] },
  { id: 'image', Icon: Image, label: 'Image (img220 = 220px wide)', wrap: ['img220(', ')', 'https://'] },
  { id: 'youtube', Icon: Youtube, label: 'YouTube video', wrap: ['youtube(', ')', 'https://youtu.be/…'] },
  { sep: true },
  { id: 'heading', Icon: Heading, label: 'Heading', line: '# ' },
  { id: 'quote', Icon: Quote, label: 'Quote', line: '> ' },
  { id: 'list', Icon: List, label: 'List', line: '- ' },
  { id: 'code', Icon: Code, label: 'Code', wrap: ['`', '`', 'code'] },
  { id: 'center', Icon: AlignCenter, label: 'Centre', wrap: ['~~~', '~~~', 'centred'] },
];

const CHEATS = [
  ['__bold__', 'bold'], ['_italic_', 'italic'], ['~~strike~~', 'struck'], ['~!spoiler!~', 'veiled'],
  ['[text](url)', 'link'], ['img220(url)', 'image, 220px'], ['youtube(url)', 'video'], ['@name', 'mention'],
  ['# Heading', 'heading'], ['> quote', 'quote'], ['- item', 'list'], ['~~~text~~~', 'centred'],
];

/** Apply a toolbar action to a textarea's selection; returns the new text + selection. */
function applyTool(tool, text, a, b) {
  if (tool.line) {
    const start = text.lastIndexOf('\n', a - 1) + 1;
    const block = text.slice(start, b);
    const lines = block.split('\n');
    const on = lines.every((l) => l.startsWith(tool.line));
    const next = lines.map((l) => (on ? l.slice(tool.line.length) : tool.line + l)).join('\n');
    return { text: text.slice(0, start) + next + text.slice(b), a: start, b: start + next.length };
  }
  const [pre, post, hint] = tool.wrap;
  const sel = text.slice(a, b);
  // Already wrapped? Unwrap (a second Ctrl+B takes the bold off again).
  if (sel && text.slice(a - pre.length, a) === pre && text.slice(b, b + post.length) === post) {
    return {
      text: text.slice(0, a - pre.length) + sel + text.slice(b + post.length),
      a: a - pre.length, b: b - pre.length,
    };
  }
  const body = sel || hint;
  return {
    text: text.slice(0, a) + pre + body + post + text.slice(b),
    a: a + pre.length, b: a + pre.length + body.length,
  };
}

/** The post as others will see it: face, name, time, (title), rendered body. */
export function PostPreview({ me, text, title, previewAs, onHide }) {
  const instant = useMemo(() => aniMarkdown(text), [text]);
  const [exact, setExact] = useState({ text: null, html: '' });
  const [checking, setChecking] = useState(false);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!text.trim() || exact.text === text) return undefined;
    let alive = true;
    const wait = Math.max(EXACT_PAUSE, lastAt.current + EXACT_MIN_GAP - Date.now());
    const t = setTimeout(async () => {
      lastAt.current = Date.now();
      setChecking(true);
      try {
        const d = await api('/anime/markdown', { method: 'POST', body: JSON.stringify({ text }) });
        if (alive) setExact({ text, html: d.html || '' });
      } catch {
        /* offline or over budget — the instant render stands */
      }
      if (alive) setChecking(false);
    }, wait);
    return () => { alive = false; clearTimeout(t); };
  }, [text, exact.text]);

  const isExact = exact.text === text && !!text.trim();
  const html = isExact ? exact.html : instant;
  const kind = { thread: 'thread', status: 'status', message: 'message', reply: 'reply', review: 'review' }[previewAs] || 'comment';
  return (
    <section className={`${m.preview} ${text.trim() ? '' : m.previewEmpty}`} aria-label="Preview — how others will see it" aria-live="polite">
      <header className={m.previewHead}>
        <span className={m.previewLabel}><Eye size={12} /> How others will see your {kind}</span>
        <span className={`${m.fidelity} ${isExact ? m.fidelityExact : ''}`} title={isExact
          ? "This is AniList's own render of your text — exactly what will be published."
          : 'Rendered as you type; AniList’s own render follows when you pause.'}
        >
          {checking && !isExact ? <Loader2 size={11} className={m.spin} /> : null}
          {isExact ? 'AniList render ✓' : 'live'}
        </span>
        {onHide && (
          <button type="button" className={m.hide} onClick={onHide} title="Hide the preview">
            <EyeOff size={12} />
          </button>
        )}
      </header>
      <article className={`${m.post} ${m[`as_${kind}`] || ''}`}>
        <PersonAvatar user={me || { name: 'you' }} size="sm" />
        <div className={m.postMain}>
          <div className={m.postHead}>
            <b className={m.postName}>{me?.name || 'you'}</b>
            <span className={m.postTime}>just now</span>
          </div>
          {kind === 'thread' && <h3 className={m.postTitle}>{title?.trim() || <i>Your title</i>}</h3>}
          {text.trim()
            ? <AniHtml html={html} className={m.postBody} cards={isExact} />
            : <p className={m.postEmpty}>Start writing — it appears here the way everyone else will read it.</p>}
        </div>
      </article>
    </section>
  );
}

export function MarkdownComposer({
  value, onChange, onSubmit, submitLabel = 'Post', placeholder = 'Write something…',
  previewAs = 'comment', title, draftKey, compact = false, autoFocus = false, onCancel,
  extra, disabled = false, rows, canSubmit = true,
}) {
  const me = useApi('/anime/me');
  const controlled = value !== undefined;
  const [own, setOwn] = useState(() => (draftKey ? store.get(DRAFT_PREFIX + draftKey, '') : ''));
  const text = controlled ? value : own;
  const setText = (v) => {
    if (controlled) onChange?.(v); else setOwn(v);
    if (draftKey) store.set(DRAFT_PREFIX + draftKey, v);
  };
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(() => store.get(PREVIEW_KEY, '1') === '1');
  const [help, setHelp] = useState(false);
  const ta = useRef(null);
  const helpId = useId();
  const restored = useRef(!!(draftKey && !controlled && own));

  useEffect(() => {
    if (autoFocus) ta.current?.focus({ preventScroll: false });
  }, [autoFocus]);

  // Grow with the text, up to a sensible height; then scroll.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, compact ? 260 : 440)}px`;
  }, [text, compact]);

  const togglePreview = () => {
    const next = !showPreview;
    setShowPreview(next);
    store.set(PREVIEW_KEY, next ? '1' : '0');
  };

  const tool = (t) => {
    const el = ta.current;
    if (!el) return;
    const r = applyTool(t, text, el.selectionStart, el.selectionEnd);
    setText(r.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.a, r.b); });
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || busy || disabled || !canSubmit || !onSubmit) return;
    setBusy(true);
    const done = await onSubmit(t);
    setBusy(false);
    if (done) {
      setText('');
      restored.current = false;
    }
  };

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      tool(TOOLS.find((x) => x.id === (e.key === 'b' ? 'bold' : 'italic')));
      return;
    }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  };

  const withPreview = showPreview;
  return (
    <div className={`${m.composer} ${compact ? m.compact : ''} ${withPreview ? m.withPreview : ''}`}>
      <div className={m.grid}>
        <div className={m.desk}>
          <div className={m.toolbar} role="toolbar" aria-label="Formatting">
            {TOOLS.map((t, i) => (t.sep
              ? <span key={`s${i}`} className={m.sep} aria-hidden="true" />
              : (
                <button key={t.id} type="button" className={m.tool} title={t.label} aria-label={t.label}
                        onMouseDown={(e) => e.preventDefault()} onClick={() => tool(t)}>
                  <t.Icon size={14} />
                </button>
              )))}
            <span className={m.grow} />
            <button type="button" className={`${m.tool} ${help ? m.toolOn : ''}`} onClick={() => setHelp((h) => !h)}
                    aria-expanded={help} aria-controls={helpId} title="Formatting help">
              <HelpCircle size={14} />
            </button>
            <button type="button" className={`${m.tool} ${m.previewToggle} ${withPreview ? m.toolOn : ''}`}
                    onClick={togglePreview} aria-pressed={withPreview} title={withPreview ? 'Hide preview' : 'Show preview'}>
              <Eye size={14} /><span>preview</span>
            </button>
          </div>
          {help && (
            <dl id={helpId} className={m.cheats}>
              {CHEATS.map(([code, what]) => (
                <div key={code}><dt><code>{code}</code></dt><dd>{what}</dd></div>
              ))}
            </dl>
          )}
          <textarea
            ref={ta}
            className={m.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={rows || (compact ? 2 : 5)}
            disabled={disabled}
            spellCheck
          />
          {(onSubmit || onCancel || extra) && (
            <div className={m.actions}>
              {onSubmit && (
                <span className={m.hint}>
                  {restored.current && text ? 'draft restored · ' : ''}
                  <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to {submitLabel.toLowerCase()}
                </span>
              )}
              {extra}
              <span className={m.grow} />
              {onCancel && (
                <button type="button" className={m.cancel} onClick={onCancel}>Cancel</button>
              )}
              {onSubmit && (
                <button type="button" className={m.submit} onClick={submit}
                        disabled={busy || disabled || !text.trim() || !canSubmit}>
                  {busy ? <Loader2 size={13} className={m.spin} /> : <Send size={13} />} {submitLabel}
                </button>
              )}
            </div>
          )}
        </div>
        {withPreview && (!compact || text.trim()) && (
          <PostPreview me={asPerson(me.data)} text={text} title={title} previewAs={previewAs} onHide={togglePreview} />
        )}
      </div>
    </div>
  );
}
