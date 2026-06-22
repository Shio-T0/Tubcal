const UNITS = [
  [60, 's'],
  [3600, 'm'],
  [86400, 'h'],
  [604800, 'd'],
  [2629800, 'w'],
  [31557600, 'mo'],
];

/** Absolute calendar label for a scheduled premiere/stream, e.g. "Jun 22, 8:00 PM". */
export function formatWhen(epochSeconds) {
  if (!epochSeconds) return '';
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Countdown to a future moment, e.g. "in 2d 4h", "in 35m", "starting soon". */
export function timeUntil(epochSeconds) {
  if (!epochSeconds) return '';
  const diff = epochSeconds - Date.now() / 1000;
  if (diff <= 0) return 'starting soon';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d ${hrs % 24}h`;
}

/** A playback offset in seconds as a clock, e.g. 75 → "1:15", 3725 → "1:02:05". */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function timeAgo(epochSeconds) {
  if (!epochSeconds) return '';
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 60) return 'now';
  let prev = 60;
  for (const [limit, label] of UNITS.slice(1).concat([[Infinity, 'y']])) {
    if (diff < limit) return `${Math.floor(diff / prev)}${label}`;
    prev = limit;
  }
  return `${Math.floor(diff / 31557600)}y`;
}
