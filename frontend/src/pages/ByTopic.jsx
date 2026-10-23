// By topic (Social channel; a module of its own that needs the Wire, shown in
// the Social bar with 3D objects on). The hundred hottest stories on
// Hacker News's front page, sorted by the local AI into five topics it names
// itself; what fits none of them is spiked. Built for 3D objects: the page is a
// machine (components/topics/), a column that sorts the headlines and then
// splits into five panels you turn round. With 3D objects off it only says so.
//
// The server does the sorting on a thread of its own (sources/hn_topics.py);
// this page reads where it's got to, every 1.5s while a sort runs and not at all
// otherwise, and asks for a new sort when the last one is over an hour old. The
// topic facing you is `?t=` (1–5, 1 2 3 4 5 on the keyboard), and the open
// story `?s=`, which pushes history so Back closes the reader.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RotateCw } from 'lucide-react';

import { api } from '../api/client.js';
import { ErrorBox, Receiving, SectionHead } from '../components/layout/Section.jsx';
import { ReaderSheet } from '../components/wire/HNReader.jsx';
import { useWireSeen } from '../components/wire/seen.js';
import Sorter, { Said } from '../components/topics/Sorter.jsx';
import { useObjects3d } from '../lib/objects3d.js';
import { timeAgo } from '../lib/time.js';
import { latestParams, useParamState } from '../lib/urlState.js';
import { useToast } from '../state.jsx';
import s from './byTopic.module.css';

const POLL_MS = 1500;

/** Only a change worth drawing replaces what the page holds. */
const sameStatus = (a, b) => a && b
  && a.status === b.status && a.stage === b.stage && a.done === b.done && a.ready === b.ready
  && a.problem === b.problem && a.jam === b.jam && a.model === b.model
  && (a.partial?.topics?.length || 0) === (b.partial?.topics?.length || 0)
  && (a.partial?.tape?.length || 0) === (b.partial?.tape?.length || 0)
  && a.result?.sorted_at === b.result?.sorted_at;

const STAGES = {
  reading: 'reading the front page',
  naming: 'naming five topics',
  sorting: 'sorting the headlines',
};

function Off() {
  return (
    <div className={s.off}>
      <p>
        By topic is built for 3D objects. Switch them on in{' '}
        <Link to="/settings?s=appearance">Settings → Appearance</Link>.
      </p>
    </div>
  );
}

export default function ByTopic() {
  const objects3d = useObjects3d();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [t, setT] = useParamState('t', '');
  const openId = Number(params.get('s')) || null;
  const { seen, newSince } = useWireSeen();
  const known = useRef(new Map());
  const tape = useRef([]); // the last sort's headlines, kept on the reel once it's done

  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try {
      const d = await api('/hackernews/topics');
      setError(null);
      setSt((prev) => (sameStatus(prev, d) ? prev : d));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { if (objects3d) load(); }, [objects3d, load]);

  const sorting = st?.status === 'sorting';
  useEffect(() => {
    if (!sorting) return undefined;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [sorting, load]);

  const sortNow = useCallback(async () => {
    try {
      await api('/hackernews/topics/sort', { method: 'POST' });
    } catch (e) {
      toast(e.message, 'error');
    }
    load();
  }, [load, toast]);

  // A sort over an hour old (or none yet): ask for a fresh one, once a visit.
  const asked = useRef(false);
  useEffect(() => {
    if (!st || asked.current || st.status === 'sorting' || !st.ready || !st.stale) return;
    asked.current = true;
    sortNow();
  }, [st, sortNow]);

  const data = sorting ? st?.partial : st?.result;
  if (st?.partial?.tape?.length) tape.current = st.partial.tape;
  const topics = data?.topics || null;
  const biggest = st?.result?.topics
    ? String(st.result.topics.reduce((a, b) => (b.items.length > a.items.length ? b : a)).n)
    : '1';
  const side = /^[1-5]$/.test(t) ? t : biggest;

  // 1–5 turn to a topic (not while typing, the player or the editor has the keys)
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (document.body.dataset.playerExpanded || document.body.dataset.editorFocused) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (!/^[1-5]$/.test(e.key) || sorting || !st?.result) return;
      e.preventDefault();
      setT(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sorting, st, setT]);

  const openStory = (item) => {
    const id = item.extra?.hn_id;
    if (!id) return;
    known.current.set(id, item);
    const p = latestParams();
    if (Number(p.get('s')) === id) return;
    const replace = !!p.get('s');
    p.set('s', String(id));
    setParams(p, { replace });
  };
  const openById = (id) => {
    const p = latestParams();
    p.set('s', String(id));
    setParams(p);
  };
  const closeStory = useCallback(() => {
    const p = latestParams();
    p.delete('s');
    setParams(p, { replace: true });
  }, [setParams]);

  if (!objects3d) return <Off />;

  let card = null;
  if (st?.status === 'jammed' && !sorting) card = { title: 'Jammed', text: st.jam };
  else if (st && !st.ready && !sorting) card = { title: 'Out of order', text: st.problem };

  const result = st?.result;
  const openItem = openId
    ? known.current.get(openId) || (topics || []).flatMap((x) => x.items).find((i) => i.extra?.hn_id === openId)
    : null;

  return (
    <div className={s.page}>
      <SectionHead>
        <span className={s.status}>
          <span className={`${s.lamp} ${sorting ? s.lampOn : ''}`} aria-hidden="true" />
          {sorting ? (
            <>
              Sorting with <b>{st.model}</b> · {STAGES[st.stage] || 'starting'}
              {st.stage === 'sorting' && st.total ? ` · ${st.done} of ${st.total}` : ''}
            </>
          ) : result ? (
            <>
              Sorted {timeAgo(result.sorted_at) === 'now' ? 'just now' : `${timeAgo(result.sorted_at)} ago`}
              {' '}· the top {result.taken} of HN&apos;s front page · <b>{result.model}</b>
              {' '}· {result.spiked.length} spiked{result.jammed ? ` (${result.jammed} jammed)` : ''}
            </>
          ) : st ? (
            <>Nothing sorted yet</>
          ) : null}
        </span>
        <button
          type="button"
          className={s.again}
          onClick={sortNow}
          disabled={!st || sorting || !st.ready}
          title={st && !st.ready ? st.problem : 'Read the front page again and sort it'}
        >
          <RotateCw size={14} className={sorting ? s.spin : ''} /> Sort again
        </button>
      </SectionHead>

      {error && <ErrorBox message={error} />}
      {!st && !error && <Receiving label="warming up the sorter" />}
      {st && result && card && <p className={s.note}><Said text={card.text} /> The last sort stays up until then.</p>}

      {st && (
        <Sorter
          topics={topics}
          spiked={data?.spiked || []}
          tape={tape.current}
          sorting={sorting}
          model={st.model}
          card={result ? null : card}
          side={side}
          onSide={setT}
          onSort={st.ready ? sortNow : null}
          openId={openId}
          onOpen={openStory}
          seen={seen}
          newSince={newSince}
        />
      )}

      {openId && <ReaderSheet item={openItem} hnId={openId} onClose={closeStory} onItem={openById} />}
    </div>
  );
}
