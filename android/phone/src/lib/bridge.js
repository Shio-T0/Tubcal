// The Android shell (MainActivity) exposes `window.TubcalAndroid`, a small
// @JavascriptInterface: the things a web page can't do for itself on a phone.
// Every call has a browser fallback, so the phone UI also runs in a desktop
// browser at phone width (that's how it's developed and screenshot-tested).

const A = () => (typeof window !== 'undefined' ? window.TubcalAndroid : null);

export const isAndroid = () => !!A();

/** The system share sheet (Android), else the Web Share API, else the clipboard. */
export function share({ title = '', url = '', text = '' }) {
  const a = A();
  if (a?.share) { a.share(title, url, text); return Promise.resolve(true); }
  if (navigator.share) return navigator.share({ title, url, text }).then(() => true, () => false);
  return navigator.clipboard?.writeText(url || text).then(() => 'copied', () => false) ?? Promise.resolve(false);
}

/** Open a link outside the app — the browser, or the YouTube/Reddit app if installed. */
export function openExternal(url) {
  const a = A();
  if (a?.openExternal) a.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

/** 'landscape' | 'portrait' | 'auto' — the player locks landscape in fullscreen. */
export function setOrientation(mode) {
  A()?.setOrientation?.(mode);
}

/** Keep the screen awake while a video plays. */
export function keepScreenOn(on) {
  A()?.keepScreenOn?.(!!on);
}

/** A light tap of the vibration motor: 'tick' (selection), 'press' (long-press), 'done'. */
export function haptic(kind = 'tick') {
  const a = A();
  if (a?.haptic) a.haptic(kind);
  else navigator.vibrate?.(kind === 'press' ? 18 : 6);
}

/** Dark status-bar icons over a light skin, light ones over a dark skin. */
export function setLightBars(light) {
  A()?.setLightBars?.(!!light);
}

/** The app's own version, for the More screen. */
export function appVersion() {
  try { return A()?.version?.() || null; } catch { return null; }
}

/** Hide the system bars for a fullscreen picture, or bring them back. */
export function setImmersive(on) {
  A()?.setImmersive?.(!!on);
}

/** A WebView silently ignores <a download> of a blob:/data: URL (the list export,
 *  the schedule's .ics). On Android, catch those clicks — real or scripted, a
 *  scripted a.click() still dispatches one — and hand the bytes to the shell,
 *  which asks where to save them. */
export function installDownloads() {
  const a = A();
  if (!a?.saveFile) return;
  const save = async (href, name) => {
    try {
      const blob = await (await fetch(href)).blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      a.saveFile(name || 'tubcal-download', blob.type || 'application/octet-stream', btoa(bin));
    } catch { /* the blob was revoked or unreadable — nothing to save */ }
  };
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('a[download]');
    if (!el || !/^(blob:|data:)/.test(el.href)) return;
    e.preventDefault();
    save(el.href, el.getAttribute('download'));
  }, true);
}
