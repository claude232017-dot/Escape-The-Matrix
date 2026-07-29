import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Source maps ship so that a stack trace from a member's phone is readable.
    // They contain no secrets: the anon key is public by design (see docs/SECURITY.md).
    sourcemap: true,
  },
  preview: {
    // CI polls the literal address 127.0.0.1. Binding to "localhost" resolves to ::1
    // first on a dual-stack runner while the server listens on 127.0.0.1, and the job
    // dies at the readiness timeout having run zero tests.
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
