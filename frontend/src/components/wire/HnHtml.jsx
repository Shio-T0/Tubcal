// Hacker News HTML (story text and comments), made safe and a little nicer.
//
// HN sends a tiny dialect — <p>, <a>, <i>, <pre><code> — but it's still a
// stranger's HTML, so it's walked with an allow-list into React elements and
// never injected. A paragraph that opens with ">" is HN's quoting convention and
// is drawn as a quote. A link to another HN item opens it in the reader when the
// page offers that (`onItem`); every other link goes out in a new tab.

import { Fragment } from 'react';

import h from './hnhtml.module.css';

const HN_ITEM = /^https?:\/\/news\.ycombinator\.com\/item\?id=(\d+)/;

function kids(node, ctx, key) {
  return Array.from(node.childNodes).map((c, i) => <Fragment key={i}>{walk(c, ctx, `${key}.${i}`)}</Fragment>);
}

function walk(node, ctx, key) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return null;
  const tag = node.tagName;
  if (tag === 'A') {
    const href = node.getAttribute('href') || '';
    const label = node.textContent;
    const item = HN_ITEM.exec(href);
    if (item && ctx.onItem) {
      return (
        <button key={key} type="button" className={h.item} onClick={(e) => { e.stopPropagation(); ctx.onItem(Number(item[1])); }}>
          {label}
        </button>
      );
    }
    if (!/^https?:\/\//i.test(href)) return <Fragment key={key}>{label}</Fragment>;
    return (
      <a key={key} className={h.link} href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
        {label}
      </a>
    );
  }
  if (tag === 'P') {
    const quote = (node.textContent || '').trimStart().startsWith('>');
    return <p key={key} className={quote ? h.quote : undefined}>{kids(node, ctx, key)}</p>;
  }
  if (tag === 'PRE') return <pre key={key} className={h.pre}>{node.textContent}</pre>;
  const El = { I: 'i', EM: 'i', B: 'b', STRONG: 'b', CODE: 'code', BR: 'br' }[tag];
  if (El === 'br') return <br key={key} />;
  if (El) return <El key={key}>{kids(node, ctx, key)}</El>;
  return <Fragment key={key}>{kids(node, ctx, key)}</Fragment>;
}

export function HnHtml({ html, className, onItem }) {
  if (!html) return null;
  // HN's first paragraph has no <p>: wrap the text before the first one so it
  // gets the same spacing as the rest.
  const src = /^\s*<p>/i.test(html) ? html : `<p>${html.replace(/<p>/i, '</p><p>')}`;
  const doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html');
  return (
    <div className={`${h.hn} ${className || ''}`}>
      {Array.from(doc.body.childNodes).map((n, i) => <Fragment key={i}>{walk(n, { onItem }, `n${i}`)}</Fragment>)}
    </div>
  );
}
