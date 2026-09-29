// A forum thread on its own page (/anime/thread/:id), and a single activity with
// its conversation (/anime/activity/:id) — where links from the inbox, from other
// posts, and from a title's Discussion block land.

import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { SingleActivity } from '../components/anime/Activity.jsx';
import { ThreadView } from '../components/anime/Thread.jsx';
import s from './animethread.module.css';

function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" className={s.back} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/anime?tab=discuss'))}>
      <ArrowLeft size={14} /> back
    </button>
  );
}

export default function AnimeThread() {
  const { id } = useParams();
  return (
    <div className={s.page}>
      <Back />
      <ThreadView key={id} threadId={Number(id)} variant="page" />
    </div>
  );
}

export function AnimeActivity() {
  const { id } = useParams();
  return (
    <div className={`${s.page} ${s.narrow}`}>
      <Back />
      <SingleActivity key={id} id={Number(id)} />
    </div>
  );
}
