const UNITS = [
  [60, 's'],
  [3600, 'm'],
  [86400, 'h'],
  [604800, 'd'],
  [2629800, 'w'],
  [31557600, 'mo'],
];

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
