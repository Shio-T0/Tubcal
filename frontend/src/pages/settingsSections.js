// The Settings page's index: its sections, how they're grouped, what each is
// called and what words find it. Kept apart from SettingsPage.jsx so light
// readers (the phone's app bar names the open section) needn't load the page.

import {
  Captions, Code2, HardDrive, History, KeyRound, LayoutGrid, Library, Newspaper, Palette, Rss, Scale, Tv, Volume2,
} from 'lucide-react';

import { hasModule } from '../lib/modules.js';

export const SETTINGS_SECTIONS = {
  accounts: {
    title: 'Accounts', icon: KeyRound,
    blurb: 'Sign in to YouTube, Reddit, AniList and GitHub for your own feeds, lists and inbox. Optional, and the tokens stay on this machine.',
    find: 'oauth connect login sign in google youtube reddit anilist github gh cli token personal access notifications credentials client id secret redirect',
  },
  subscriptions: {
    title: 'Subscriptions', icon: Rss,
    blurb: 'The channels, subreddits and GitHub repos Tubcal follows for you.',
    find: 'follow channels youtube subreddits reddit github repos users add remove unsubscribe',
  },
  history: {
    title: 'Watch history', icon: History,
    blurb: 'What you watch is remembered here to pick “The Projection”. Nothing is sent anywhere.',
    find: 'history watched clear forget privacy projection',
  },
  data: {
    title: 'Your data', icon: HardDrive,
    blurb: 'Everything Tubcal keeps is one file on this machine. A copy is taken each day, so a bad day can be undone.',
    find: 'data database backup backups snapshot snapshots restore undo copy file size storage disk sqlite cache export',
  },
  appearance: {
    title: 'Appearance', icon: Palette,
    blurb: 'Repaint the whole station, or keep it still with Fast mode. The Shōwa set is home; the rest are other machines.',
    find: 'skin theme look colours dark light night day terminal bauhaus blueprint aqua space fast mode animation animations motion transitions still speed reduce',
  },
  rooms: {
    title: 'Rooms', icon: LayoutGrid,
    blurb: 'Which rooms each channel shows. A room left out still opens from its address.',
    find: 'rooms channels social coding video console numbers enable disable max edition screening wire archive workbench github dispatch anime',
  },
  playback: {
    title: 'Playback', icon: Volume2,
    blurb: 'How videos sound and how fast they play, everywhere.',
    find: 'audio sound solo mix mute speed rate',
  },
  subtitles: {
    title: 'Subtitles', icon: Captions,
    blurb: 'How subtitles look in every player, on this machine and the phone. A player’s subtitle menu has the same controls.',
    find: 'subtitles captions font size colour color outline shadow backdrop language height',
  },
  anime: {
    title: 'Anime', icon: Tv, module: 'anime',
    blurb: 'Episodes stream from hianime, the source ani-cli uses. Connect AniList under Accounts to sync your list.',
    find: 'anime sub dub audio anilist sync progress skip openings opening theme song volume',
  },
  edition: {
    title: 'The Edition', icon: Newspaper, module: 'edition',
    blurb: 'The daily paper, composed from everything you follow. Works without AI; Ollama upgrades it to written prose.',
    find: 'edition paper daily news hour writer model ollama recompose press',
  },
  archive: {
    title: 'The Archive', icon: Library, module: 'archive',
    blurb: 'Transcribes what you watch into a private, searchable memory, with on-device summaries.',
    find: 'archive transcription whisper ollama llm summaries embedding search index brain',
  },
  editor: {
    title: 'The Composing Room', icon: Code2, desktopOnly: true, module: 'editor',
    blurb: 'The code editor over your local workspace.',
    find: 'editor code composing lsp language servers autosave line numbers relative leader vim',
  },
  about: {
    title: 'About', icon: Scale,
    blurb: 'Who made this, the licence, and what it’s built on.',
    find: 'about licence license gpl copyright source notices libraries warranty',
  },
};

/** The sections this copy shows: a module's section only with its module, and
 *  desktop-only ones not on the phone. */
export function settingsSectionIds(phone = false) {
  return SETTINGS_GROUPS.flatMap((g) => g.ids).filter((id) => {
    const sec = SETTINGS_SECTIONS[id];
    return !(phone && sec.desktopOnly) && (!sec.module || hasModule(sec.module));
  });
}

export const SETTINGS_GROUPS = [
  { title: 'Your things', ids: ['accounts', 'subscriptions', 'history', 'data'] },
  { title: 'The look', ids: ['appearance', 'rooms'] },
  { title: 'Watching', ids: ['playback', 'subtitles', 'anime'] },
  { title: 'The machines', ids: ['edition', 'archive', 'editor'] },
  { title: null, ids: ['about'] },
];
