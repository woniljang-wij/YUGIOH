import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: '/react-build/',
  plugins: [react()],
  root: frontendDirectory,
  build: {
    outDir: resolve(frontendDirectory, 'react-build'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        login: resolve(frontendDirectory, 'react.html'),
        start: resolve(frontendDirectory, 'react-start.html'),
        lobby: resolve(frontendDirectory, 'index.html'),
        duel: resolve(frontendDirectory, 'duel.html')
      }
    }
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/assets': 'http://127.0.0.1:5000',
      '/login': 'http://127.0.0.1:5000',
      '/start': 'http://127.0.0.1:5000',
      '/start.html': 'http://127.0.0.1:5000',
      '/index.html': 'http://127.0.0.1:5000',
      '/duel.html': 'http://127.0.0.1:5000'
    }
  }
});
