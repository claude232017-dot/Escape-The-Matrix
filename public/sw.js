/**
 * The service worker.
 *
 * §3.9: **offers updates, does not impose them. No `skipWaiting()` in `install`.**
 *
 * That rule is short and the reason is not. A worker that calls `skipWaiting()` during install
 * takes control the moment it finishes downloading — which, for a man halfway through filing a
 * SITREP on a train, means the page he is typing into is replaced by a different build. His
 * unsaved answers go with it. The update was not urgent; the interruption was.
 *
 * So this worker installs, waits, and tells the page there is something new. The page decides
 * when — see src/app/service-worker.ts, which surfaces it as a button and never as a reload.
 * `skipWaiting` is still here, but only behind a message the page has to send.
 *
 * The cache is deliberately thin. This is not an offline-first app: writes survive a lost
 * connection through the outbox (§3.10), which is a much stronger guarantee than a cached
 * shell, and caching API responses would mean showing a man yesterday's day as though it were
 * today's. Only the app shell is cached, and every request for data goes to the network.
 */

const CACHE = 'etm-shell-v1';

/**
 * The shell, and nothing else.
 *
 * No `/rest/`, no `/auth/`, no `/rpc/`. A cached SITREP is a lie about what the server holds,
 * and a cached auth response is a security problem — see the fetch handler.
 */
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  // NO skipWaiting() HERE. §3.9. See the header — this is the whole point of the file.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Network first, shell as a fallback, and **nothing about a member is ever cached**.
 *
 * §3.5 is why the early return matters more than the caching does. Supabase responses carry
 * protocol detail, revenue and the Bottom G tactics; putting those in the Cache API would leave
 * them on disk, unencrypted, surviving sign-out — which `clearUserState` could not reach and
 * §3.8 promises is cleared.
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that is not this origin's static shell goes straight to the network, uncached.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache what the shell is made of, and only when the server said it was good.
        if (response.ok && request.destination !== '') {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('/index.html'))),
  );
});

/**
 * The only route to taking over, and the page has to ask.
 *
 * This is what makes "offers, does not impose" true rather than aspirational: the waiting
 * worker cannot activate itself, so the decision belongs to the man looking at the screen.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'etm-apply-update') self.skipWaiting();
});
