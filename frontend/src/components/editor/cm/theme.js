// The Shōwa buffer: CodeMirror themed entirely through design tokens.
// Every color is a var(--token) reference, so the editor reskins live with the
// app — Phosphor Terminal turns it green-on-black, Blueprint cyan-on-navy —
// with no JS work at theme-switch time. Syntax colors are the warm dye family
// (--rail-*), not a stock dark theme: the buffer reads as part of the set.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const showaHighlight = HighlightStyle.define([
  // amber phosphor for the words that steer control flow
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: 'var(--signal)' },
  { tag: [t.self, t.atom, t.special(t.variableName)], color: 'var(--signal)' },
  // matcha for literals of prose: strings, regexps
  { tag: [t.string, t.special(t.string), t.regexp, t.docString], color: 'var(--rail-2)' },
  // ochre for the callable
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--rail-1)' },
  // persimmon pop for constants and numbers
  { tag: [t.number, t.bool, t.null, t.constant(t.variableName), t.escape], color: 'var(--accent-strong)' },
  // terracotta for types and classes
  { tag: [t.typeName, t.className, t.namespace, t.annotation], color: 'var(--rail-4)' },
  // comments are marginalia: faint and italic
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: 'var(--paper-faint)', fontStyle: 'italic' },
  // structure recedes
  { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: 'var(--paper-dim)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--paper)' },
  { tag: [t.definition(t.variableName), t.local(t.variableName)], color: 'var(--paper)' },
  { tag: t.invalid, color: 'var(--danger)' },
  // markdown & friends
  { tag: t.heading, color: 'var(--paper)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--signal)', textDecoration: 'underline' },
  { tag: t.quote, color: 'var(--paper-dim)', fontStyle: 'italic' },
  { tag: t.inserted, color: 'var(--success)' },
  { tag: t.deleted, color: 'var(--danger)' },
]);

const showaTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13.5px',
    backgroundColor: 'transparent',
    color: 'var(--paper)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-code)',
    lineHeight: '1.6',
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--rule-strong) transparent',
  },
  '.cm-content': {
    caretColor: 'var(--accent-strong)',
    padding: '10px 0 40vh 0', // typewriter tail: the last line never sits on the floor
  },
  '&.cm-focused': { outline: 'none' },

  // ---- gutter: tabular figures against a hairline, like the Edition dateline
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--paper-faint)',
    borderRight: '1px solid var(--rule)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11.5px',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px', minWidth: '42px' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--signal)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--paper) 3.5%, transparent)',
  },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--paper-faint)', cursor: 'pointer' },
  '.cm-foldPlaceholder': {
    background: 'var(--surface)',
    border: '1px solid var(--rule)',
    borderRadius: '4px',
    color: 'var(--paper-dim)',
    padding: '0 6px',
    margin: '0 3px',
  },

  // ---- selection & cursors: inverted amber, phosphor block in normal mode
  '.cm-selectionBackground': { backgroundColor: 'var(--signal-soft) !important' },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--signal) 26%, transparent) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--signal) 12%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent-strong)' },
  '&.cm-focused .cm-fat-cursor': {
    background: 'var(--signal) !important',
    color: 'var(--ink) !important',
    boxShadow: '0 0 8px var(--accent-glow)',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    background: 'none !important',
    color: 'inherit !important',
    outline: '1px solid color-mix(in srgb, var(--signal) 55%, transparent)',
  },

  // ---- brackets, search, panels
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: '1px solid var(--rule-strong)',
    borderRadius: '2px',
  },
  '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--danger)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--rail-1) 22%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--rail-1) 40%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--rail-1) 42%, transparent)',
  },

  // the vim ex line (:w) and search prompt — a mono strip on a hairline rule
  '.cm-panels': {
    backgroundColor: 'var(--ink-2)',
    color: 'var(--paper)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
  },
  '.cm-panels-bottom': { borderTop: '1px solid var(--rule)' },
  '.cm-vim-panel': { padding: '3px 10px', minHeight: '24px' },
  '.cm-vim-panel input': {
    color: 'var(--signal)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12.5px',
  },
  '.cm-vim-message': { padding: '3px 10px', color: 'var(--paper-dim)' },

  // ---- autocomplete & tooltips: the command-palette idiom, in miniature
  '.cm-tooltip': {
    background: 'color-mix(in srgb, var(--ink-2) 94%, transparent)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--r-input)',
    color: 'var(--paper)',
    boxShadow: 'var(--shadow-card)',
    backdropFilter: 'blur(10px)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-code)',
    fontSize: '12.5px',
    maxHeight: '14em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--signal-soft)',
    color: 'var(--paper)',
  },
  '.cm-completionIcon': { color: 'var(--paper-faint)' },
  '.cm-completionMatchedText': { color: 'var(--signal)', textDecoration: 'none' },
  '.cm-completionDetail': { color: 'var(--paper-faint)', fontStyle: 'italic' },
  '.cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: 'var(--rule-strong)' },
  '.cm-tooltip-lint': { fontFamily: 'var(--font-body)', fontSize: '12.5px' },

  // ---- diagnostics: dyes, not alarm paint
  '.cm-diagnostic': { borderLeft: '3px solid var(--paper-faint)', padding: '4px 8px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--rail-1)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger) 1px',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy color-mix(in srgb, var(--rail-1) 75%, transparent) 1px',
    textUnderlineOffset: '3px',
  },
  '.cm-lint-marker-error': { content: 'none' },

  // ---- git gutter: thin dye ticks like the Edition's slug rule
  '.cm-gitGutter': { width: '4px' },
  '.cm-gitGutter .cm-gutterElement': { padding: '0' },
  '.cm-git-add': { background: 'var(--success)', height: '100%', width: '3px', borderRadius: '2px' },
  '.cm-git-mod': { background: 'var(--rail-1)', height: '100%', width: '3px', borderRadius: '2px' },
  '.cm-git-del': {
    width: '0',
    height: '0',
    borderLeft: '5px solid var(--accent-strong)',
    borderTop: '4px solid transparent',
    borderBottom: '4px solid transparent',
    marginTop: '-4px',
  },
});

export function showaEditorTheme() {
  return [showaTheme, syntaxHighlighting(showaHighlight)];
}
