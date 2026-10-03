import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import legal from './src/build/legal.mjs';

export default defineConfig({
  // Who this build is, for Settings → About (the phone build sets its own).
  define: {
    __TUBCAL_APP__: JSON.stringify({
      name: 'Tubcal', year: '2026', author: 'shio-t0', source: 'https://github.com/Shio-T0/Tubcal',
    }),
  },
  plugins: [
    react(),
    // dist/legal/: Tubcal's licence, its third-party notices, and the licence of
    // every npm package in the bundle — Settings → About shows them.
    legal({
      files: {
        'LICENSE.txt': path.resolve(__dirname, '../LICENSE'),
        'THIRD_PARTY_NOTICES.md': path.resolve(__dirname, '../THIRD_PARTY_NOTICES.md'),
      },
    }),
  ],
  server: {
    proxy: {
      // ws:true so the Composing Room's PTY/LSP sockets proxy through in dev.
      '/api': { target: 'http://127.0.0.1:5000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the rarely-changing React runtime into its own long-cached chunk
        // so app-code rebuilds don't invalidate it.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
