// HTML that GitHub rendered (READMEs, release notes, issue bodies, comments),
// sanitized like any remote HTML, with its links made to work in place:
//   - a link to github.com opens the matching page here (repo, thread, commit, file);
//   - a relative link in a repo's Markdown opens that file in the code view;
//   - "#heading" scrolls to the heading (GitHub prefixes ids with user-content-);
//   - anything else opens in a new tab.

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { sanitizeHtml } from '../../lib/format.js';
import { scrollMotion } from '../../lib/motion.js';
import { codePath, ghRoute, resolveRelative } from '../../lib/gh.js';
import g from './gh.module.css';

export default function GhHtml({ html, repo, dir = '', refName, className = '' }) {
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const inApp = ghRoute(a.href) || (repo && resolveRelative(href, dir) != null);
      if (!inApp && !href.startsWith('#')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });
    // GitHub's task lists arrive as disabled checkboxes; keep them unclickable.
    root.querySelectorAll('input[type=checkbox]').forEach((i) => { i.disabled = true; });
  }, [html, repo, dir]);

  const onClick = useCallback((e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      const el = ref.current?.querySelector(`[id="user-content-${CSS.escape(id)}"], [id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: scrollMotion(), block: 'start' });
      }
      return;
    }
    const route = ghRoute(a.href);
    if (route) {
      e.preventDefault();
      navigate(route);
      return;
    }
    if (repo) {
      const path = resolveRelative(href, dir);
      if (path != null) {
        e.preventDefault();
        navigate(codePath(repo, path, refName));
      }
    }
  }, [navigate, repo, dir, refName]);

  if (!html) return null;
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div ref={ref} className={`${g.md} ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
  );
}
