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
    // No source maps in the deployed build.
    //
    // They were on, and the reasoning written here was about secrets — the anon key is public
    // by design (§3.3), so the map leaks no credential. That was true and beside the point. The
    // map was 2.4 MB against a 560 kB bundle, and Vercel served it: the complete, commented,
    // original source of a private application, readable by anyone who opened devtools on the
    // deploy. Nobody decided that; it was the default and the comment made it sound considered.
    //
    // The thing the map was for — a readable stack trace from a member's phone — is Phase 9's
    // job, and the mechanism there is *uploading* maps to an error reporter, not publishing them
    // next to the bundle. So this costs nothing that is not being rebuilt properly later.
    sourcemap: false,

    // The app is ~165 kB gzipped, over Rollup's 500 kB *uncompressed* default. Raised rather
    // than chased: the alternative is code-splitting a single-screen-at-a-time app used by
    // twelve men, which adds chunk-loading states and a waterfall on mobile data to fix a
    // warning rather than a problem. framer-motion is already behind LazyMotion. If this
    // threshold is ever hit, that is a real signal worth looking at.
    chunkSizeWarningLimit: 700,
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
