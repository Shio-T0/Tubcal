// Git gutter: thin dye ticks (matcha add / ochre modify / persimmon delete)
// in a dedicated 4px gutter. Marks are pushed in via setGitMarks whenever the
// backend diff is (re)fetched — on open and after every save.

import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';

export const setGitMarks = StateEffect.define();

class Tick extends GutterMarker {
  constructor(type) {
    super();
    this.type = type;
  }
  eq(other) {
    return other.type === this.type;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-git-${this.type}`;
    return el;
  }
}

const MARKERS = { add: new Tick('add'), mod: new Tick('mod'), del: new Tick('del') };

const gitMarksField = StateField.define({
  create: () => ({ marks: [] }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGitMarks)) value = { marks: e.value };
    return value;
  },
});

export function gitGutter() {
  return [
    gitMarksField,
    gutter({
      class: 'cm-gitGutter',
      lineMarker(view, line) {
        const { marks } = view.state.field(gitMarksField);
        if (!marks.length) return null;
        const n = view.state.doc.lineAt(line.from).number;
        const hit = marks.find((m) => m.line === n);
        return hit ? MARKERS[hit.type] || null : null;
      },
      lineMarkerChange: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setGitMarks))),
    }),
  ];
}
