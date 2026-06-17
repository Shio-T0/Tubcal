import { useEffect, useRef } from 'react';

import { sanitizeHtml } from '../../lib/format.js';

/** Renders remote HTML (Reddit/HN bodies) sanitized, links forced to new tabs. */
export default function SafeHtml({ html, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.querySelectorAll('a').forEach((a) => {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    });
  }, [html]);

  if (!html) return null;
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
}
