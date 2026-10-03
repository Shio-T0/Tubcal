// The phone frontend of Tubcal for Android.
//
// The desktop frontend's source (../../frontend/src) is imported in place as `@pc`:
// the phone app reuses its logic (the API client, the shared state, data hooks and
// a few deep components) under its own phone shell and screens in `src/`. Nothing
// is copied, so the phone always builds against the desktop code next to it.
//
// Class names from the desktop's CSS modules come out stable and readable
// (`pc_<dir>_<file>__<class>`), so phone.css can adapt any desktop screen the phone
// reuses without touching the desktop source. The build lands in the Android
// build's generated assets (android/app/build/generated/phone-web/web), and Gradle
// runs it before every APK build (app/build.gradle.kts → buildPhoneUi).

import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import legal from '../../frontend/src/build/legal.mjs';

const REPO = path.resolve(__dirname, '../..');
const PC = path.join(REPO, 'frontend', 'src') + path.sep;
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

function scopedName(name, filename) {
  const file = path.basename(filename).replace(/\.module\.css$/, '').replace(/\W/g, '_');
  if (filename.startsWith(PC)) {
    const dir = path.basename(path.dirname(filename)).replace(/\W/g, '_');
    return `pc_${dir}_${file}__${name}`;
  }
  // phone modules: readable too, but salted so two phone files can share a name
  let h = 0;
  for (const ch of filename) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `ph_${file}__${name}_${(h % 46656).toString(36)}`;
}

export default defineConfig({
  // Who this build is, for Settings → About (shared with the desktop's settings page).
  define: {
    __TUBCAL_APP__: JSON.stringify({
      name: 'Tubcal for Android',
      year: '2026',
      author: 'shio-t0',
      source: 'https://github.com/Shio-T0/Tubcal',
      legal: [{ path: '/legal/python-licenses.txt', label: 'Python & runtime', note: 'CPython, Chaquopy, pip packages' }],
    }),
  },
  plugins: [
    react(),
    // legal/: the licence, the notices, the Python side's list (tools/gen-licenses.py)
    // and every npm package in the bundle — Settings → About shows them.
    legal({
      title: 'Tubcal for Android',
      files: {
        'LICENSE.txt': path.join(REPO, 'LICENSE'),
        'THIRD_PARTY_NOTICES.md': path.join(REPO, 'THIRD_PARTY_NOTICES.md'),
        'python-licenses.txt': path.resolve(__dirname, '../app/src/main/legal/python-licenses.txt'),
      },
    }),
  ],
  resolve: {
    alias: { '@pc': path.join(REPO, 'frontend', 'src') },
    // The desktop files live outside this folder, so their bare imports would
    // otherwise resolve from frontend/node_modules (or fail when that isn't
    // installed). Every dependency resolves from here instead — one copy of React.
    dedupe: Object.keys(pkg.dependencies || {}),
  },
  css: { modules: { generateScopedName: scopedName } },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:5000', ws: true } },
    fs: { allow: [__dirname, path.join(REPO, 'frontend'), path.join(REPO, 'LICENSE')] },
  },
  build: {
    outDir: path.resolve(__dirname, '../app/build/generated/phone-web/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
});
