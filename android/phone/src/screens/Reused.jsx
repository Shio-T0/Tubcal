// The desktop pages the phone runs as they are, under a phone app bar: the
// anime people/thread/profile pages, The Archive, The Workbench and Settings.
// They already work at narrow widths; phone.css (`.ph-reuse`) tightens their
// gutters, hides their blurbs and fattens their buttons. (The Composing Room
// stays a desktop room — a code editor has no business on a phone.)

import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';

import { AppBar, Loading } from '../shell/Shell.jsx';

const PAGES = {
  voice: { title: 'Voice actor', back: '/anime', tone: 'var(--c-anime)', C: lazy(() => import('@pc/pages/VoiceActor.jsx')) },
  character: { title: 'Character', back: '/anime', tone: 'var(--c-anime)', C: lazy(() => import('@pc/pages/AnimeCharacter.jsx')) },
  studio: { title: 'Studio', back: '/anime', tone: 'var(--c-anime)', C: lazy(() => import('@pc/pages/AnimeStudio.jsx')) },
  user: { title: 'Profile', back: '/anime?tab=discuss', tone: 'var(--c-anime)', C: lazy(() => import('@pc/pages/AnimeUser.jsx')) },
  thread: { title: 'Thread', back: '/anime?tab=discuss', tone: 'var(--c-anime)', C: lazy(() => import('@pc/pages/AnimeThread.jsx')) },
  activity: { title: 'Activity', back: '/anime?tab=discuss&d=activity', tone: 'var(--c-anime)', C: lazy(() => import('@pc/pages/AnimeThread.jsx').then((m) => ({ default: m.AnimeActivity }))) },
  archive: { title: 'The Archive', back: '/more', tone: 'var(--signal)', C: lazy(() => import('@pc/pages/Archive.jsx')) },
  dev: { title: 'The Workbench', back: '/more', tone: 'var(--c-dev)', C: lazy(() => import('@pc/pages/Workbench.jsx')) },
  settings: { title: 'Settings', back: '/more', tone: 'var(--signal)', C: lazy(() => import('@pc/pages/SettingsPage.jsx')) },
};

export default function Reused({ page }) {
  const params = useParams();
  const p = PAGES[page];
  const sub = page === 'user' ? params.name : null;
  return (
    <div className={`ph-reuse-page ph-page-${page}`}>
      <AppBar title={p.title} sub={sub} back backTo={p.back} tone={p.tone} />
      <div className={`ph-reuse ${page.match(/voice|character|studio|user|thread|activity/) ? 'ph-anime' : ''}`}>
        <Suspense fallback={<Loading />}>
          <p.C />
        </Suspense>
      </div>
    </div>
  );
}
