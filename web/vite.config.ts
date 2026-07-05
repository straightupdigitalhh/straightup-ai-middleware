import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Das Hub wird vom Express-Server unter /app ausgeliefert.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: { outDir: 'dist' },
  server: {
    port: 5173,
    // Lokale Entwicklung: API-Calls an die laufende Middleware durchreichen
    proxy: {
      '/api': 'http://localhost:3500',
      '/auth': 'http://localhost:3500',
    },
  },
});
