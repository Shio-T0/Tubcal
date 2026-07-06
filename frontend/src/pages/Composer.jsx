// No 08 — The Composing Room. Where the type gets set: a vim-handed code
// editor over the local workspace, with the comforts of a full IDE.

import { useApi } from '../api/client.js';
import EditorRoom from '../components/editor/EditorRoom.jsx';
import { SectionHead } from '../components/layout/Section.jsx';
import s from './composer.module.css';

const EDITOR_C = 'var(--c-editor)';

export default function Composer() {
  const status = useApi('/editor/status');
  const d = status.data;

  return (
    <section className={s.wrap}>
      <SectionHead
        kicker="No 08 — The Composing Room"
        title="The Composing Room"
        note="Set your own type. Vim hands, editor comforts — the workspace, in the corner of the living room."
        color={EDITOR_C}
      >
        {d && (
          <div className={s.colophon}>
            <span className={s.rootChip} title="workspace root — TUBCAL_EDITOR_ROOT">
              {shortHome(d.root)}
            </span>
            <span className={s.caps}>
              <Cap on={d.git} label="git" />
              <Cap on={d.rg} label="rg" />
              <Cap on={d.terminal} label="tty" />
              <Cap on={Object.values(d.lsp || {}).some(Boolean)} label="lsp" />
            </span>
          </div>
        )}
      </SectionHead>
      <EditorRoom />
    </section>
  );
}

function Cap({ on, label }) {
  return (
    <span className={`${s.cap} ${on ? s.capOn : ''}`} title={on ? `${label} available` : `${label} unavailable`}>
      {label}
    </span>
  );
}

function shortHome(p) {
  const home = p.match(/^\/home\/[^/]+/);
  return home ? p.replace(home[0], '~') : p;
}
