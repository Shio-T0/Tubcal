// How a saved entry looks in a list: its kind's icon, and one line saying what it
// is, where it's from and when it was kept. Shared by the Saved page, the drawer
// and the command palette.

import {
  Activity, BookOpen, Building2, CircleDot, Clapperboard, Code2, FileText, GitBranch, GitCommitHorizontal,
  GitPullRequest, Hash, Link2, ListVideo, MessagesSquare, Mic, Podcast, Quote, Radio, SquareUser, Tag, Tv, UserRound,
} from 'lucide-react';

import { KINDS, kindOf } from '../../lib/saveable.js';
import { clock, timeAgo } from '../../lib/time.js';

export const KIND_ICON = {
  video: Clapperboard,
  moment: Quote,
  playlist: ListVideo,
  ytchannel: SquareUser,
  anime: Tv,
  character: UserRound,
  staff: Mic,
  studio: Building2,
  thread: MessagesSquare,
  story: Hash,
  post: Radio,
  subreddit: Radio,
  repo: GitBranch,
  release: Tag,
  pull: GitPullRequest,
  issue: CircleDot,
  commit: GitCommitHorizontal,
  ghuser: UserRound,
  event: Activity,
  file: Code2,
  article: FileText,
  podcast: Podcast,
  doc: BookOpen,
  page: Link2,
  link: Link2,
};

export function KindIcon({ item, kind, size = 14, ...rest }) {
  const Icon = KIND_ICON[kind || kindOf(item)] || Link2;
  return <Icon size={size} aria-hidden="true" {...rest} />;
}

/** "kept 3d ago", "kept just now". */
export function keptAgo(item) {
  if (!item.saved_at) return '';
  const t = timeAgo(item.saved_at);
  return t === 'now' ? 'kept just now' : `kept ${t} ago`;
}

/** The kind and where it's from, in a few words: "HN story · news.ycombinator.com". */
export function kindLine(item) {
  const kind = kindOf(item);
  const bits = [KINDS[kind]?.one || 'link'];
  if (kind === 'moment') bits.push(`at ${clock(item.extra?.t || 0)}`);
  const from = item.source || item.author;
  if (from) bits.push(from);
  return bits.join(' · ');
}
