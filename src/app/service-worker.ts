/**
 * Registering the service worker, and surfacing an update as an offer.
 *
 * §3.9 in the client half: the worker in `public/sw.js` never takes control on its own, so
 * something has to notice it is waiting and tell the man. That is this file — and the important
 * property is what it does *not* do. It never reloads the page by itself, and it never applies
 * an update because one is available. It sets a flag; a button does the rest.
 *
 * The failure this prevents: a man halfway through a SITREP on a train, page swapped under him,
 * unsaved answers gone. The update was not urgent. The interruption was.
 */

export type UpdateListener = (available: boolean) => void;

const listeners = new Set<UpdateListener>();
let waiting: ServiceWorker | null = null;

/** True once a new build is downloaded and waiting for permission. */
export function onUpdateAvailable(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener(waiting !== null);
  return () => listeners.delete(listener);
}

function announce(worker: ServiceWorker | null): void {
  waiting = worker;
  for (const listener of listeners) listener(worker !== null);
}

/**
 * Apply the waiting update, because he asked.
 *
 * Two steps, and both are needed: the worker has to be told it may take over, and the page has
 * to reload to be served by it. The reload happens *after* `controllerchange`, so it never fires
 * before the new worker is actually in charge — reloading first would just re-serve the old
 * build and look like the button did nothing.
 */
export function applyUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  waiting.postMessage('etm-apply-update');
}

/**
 * Register, and watch for a successor.
 *
 * Skipped entirely in development and in the test harness: a worker caching the shell across
 * rebuilds is a source of "why am I still seeing the old page" that costs more than it saves,
 * and the harness serves fixture routes that must never be cached.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (import.meta.env['VITE_TEST_HARNESS'] === '1') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Already waiting when the page loaded — a build downloaded during the last visit.
        if (registration.waiting) announce(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `installed` with an existing controller means: a new build is ready and an old
            // one is still running the page. Without the controller check this fires on the
            // very first install, and would offer an update to a man who has just arrived.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing);
            }
          });
        });
      })
      .catch(() => {
        // A failed registration is not worth a message to a member. The app works without it —
        // that is the point of the worker being an enhancement rather than the delivery
        // mechanism.
      });
  });
}
