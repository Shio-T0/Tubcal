// A Hacker News discussion as a slide-in page (the Hacker News room's part of the
// phone app, in its split APK): the desktop's reader, threaded, with "new since
// your last visit". discuss.jsx's opener loads it when this phone has the room.

import { useRef, useState } from 'react';
import { Share2 } from 'lucide-react';

import { HNReader } from '@pc/components/wire/HNReader.jsx';
import { splitKind } from '@pc/lib/format.js';

import { share } from '../lib/bridge.js';
import { IconBtn, Overlay } from '../shell/Shell.jsx';
import d from './discuss.module.css';

/** An HN story's discussion. Links to other HN items inside it open in place. */
export function HNPage({ item, onClose }) {
  const [stack, setStack] = useState([]);
  const cur = stack[stack.length - 1] || item;
  const hnId = cur?.extra?.hn_id;
  const body = useRef(null);
  // Back steps out of a linked item first; only then does the page close.
  const back = () => {
    if (!stack.length) return false;
    setStack((s) => s.slice(0, -1));
    return true;
  };
  const onItem = (id) => {
    setStack((s) => [...s, { id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } }]);
    body.current?.scrollTo(0, 0);
  };
  const { kind } = splitKind(cur?.title || '');
  const url = `https://news.ycombinator.com/item?id=${hnId}`;
  return (
    <Overlay
      open={!!item}
      onClose={onClose}
      onBack={back}
      title="Discussion"
      sub={kind || cur?.extra?.domain || 'Hacker News'}
      tone="var(--c-hn)"
      bodyRef={body}
      actions={<IconBtn label="Share" onClick={() => share({ title: cur?.title, url })}><Share2 size={20} /></IconBtn>}
    >
      {cur && (
        <div className={d.hn}>
          <HNReader key={hnId} item={cur.title ? cur : undefined} hnId={hnId} onItem={onItem} variant="sheet" />
        </div>
      )}
    </Overlay>
  );
}

export default HNPage;
