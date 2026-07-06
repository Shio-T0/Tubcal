import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
