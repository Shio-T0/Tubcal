// The Settings page's index: its sections, how they're grouped, what each is
// called and what words find it. Kept apart from SettingsPage.jsx so light
// readers (the phone's app bar names the open section) needn't load the page.

import {
  Captions, Code2, History, KeyRound, LayoutGrid, Library, Newspaper, Palette, Rss, Scale, Tv, Volume2,
} from 'lucide-react';

export const SETTINGS_SECTIONS = {
  accounts: {
    title: 'Accounts', icon: KeyRound,
    blurb: 'Sign in to YouTube, Reddit and AniList for your own feeds and lists. Optional, and the tokens stay on this machine.',
    find: 'oauth connect login sign in google youtube reddit anilist credentials client id secret redirect',
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
  appearance: {
    title: 'Appearance', icon: Palette,
    blurb: 'Repaint the whole station. The Shōwa set is home; the rest are other machines.',
    find: 'skin theme look colours dark light night day terminal bauhaus blueprint aqua space',
  },
  rooms: {
    title: 'Rooms', icon: LayoutGrid,
    blurb: 'Which rooms sit in the hub. A room left out still opens from its address.',
    find: 'rooms hub console numbers enable disable max edition screening wire archive workbench github dispatch',
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
    title: 'Anime', icon: Tv,
    blurb: 'Episodes stream from hianime, the source ani-cli uses. Connect AniList under Accounts to sync your list.',
    find: 'anime sub dub audio anilist sync progress skip openings opening theme song volume',
  },
  edition: {
    title: 'The Edition', icon: Newspaper,
    blurb: 'The daily paper, composed from everything you follow. Works without AI; Ollama upgrades it to written prose.',
    find: 'edition paper daily news hour writer model ollama recompose press',
  },
  archive: {
    title: 'The Archive', icon: Library,
    blurb: 'Transcribes what you watch into a private, searchable memory, with on-device summaries.',
    find: 'archive transcription whisper ollama llm summaries embedding search index brain',
  },
  editor: {
    title: 'The Composing Room', icon: Code2, desktopOnly: true,
    blurb: 'The code editor over your local workspace.',
    find: 'editor code composing lsp language servers autosave line numbers relative leader vim',
  },
  about: {
    title: 'About', icon: Scale,
    blurb: 'Who made this, the licence, and what it’s built on.',
    find: 'about licence license gpl copyright source notices libraries warranty',
  },
};

export const SETTINGS_GROUPS = [
  { title: 'Your things', ids: ['accounts', 'subscriptions', 'history'] },
  { title: 'The look', ids: ['appearance', 'rooms'] },
  { title: 'Watching', ids: ['playback', 'subtitles', 'anime'] },
  { title: 'The machines', ids: ['edition', 'archive', 'editor'] },
  { title: null, ids: ['about'] },
];
