import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * §3.9, asserted against the file that ships.
 *
 * "Service worker offers updates, does not impose them. **No `skipWaiting()` in `install`.**"
 *
 * That is a rule about one line in one file, and it is exactly the kind of line that gets added
 * back by somebody debugging a stale cache at eleven at night. The cost is not abstract: a
 * worker that skips waiting takes control the moment it downloads, so a man halfway through
 * filing a SITREP on a train has the page swapped under him and loses what he had typed.
 *
 * Read as text rather than imported, because a service worker cannot be imported into a test —
 * it expects `self` to be a ServiceWorkerGlobalScope. Crude, and it checks the thing that
 * actually ships.
 */

const RAW = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

/**
 * Comments removed before anything is matched.
 *
 * The worker's own comment says "NO skipWaiting() HERE", which is the right thing for it to say
 * and made the first version of this test fail on the file it was written to approve. A rule
 * about which calls exist must not be satisfiable — or breakable — by prose.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The body of one top-level `addEventListener('<name>', …)` handler. */
function handler(name: string): string {
  const start = SOURCE.indexOf(`addEventListener('${name}'`);
  expect(start, `no ${name} handler in sw.js`).toBeGreaterThan(-1);

  let depth = 0;
  let seen = false;
  for (let i = start; i < SOURCE.length; i += 1) {
    const char = SOURCE[i];
    if (char === '{') {
      depth += 1;
      seen = true;
    } else if (char === '}') {
      depth -= 1;
      if (seen && depth === 0) return SOURCE.slice(start, i + 1);
    }
  }
  return SOURCE.slice(start);
}

describe('the service worker', () => {
  it('finds the handlers it claims to be checking', () => {
    // Without this a broken extractor makes every assertion below vacuously true.
    expect(handler('install')).toContain('waitUntil');
    expect(handler('fetch')).toContain('respondWith');
    expect(handler('message')).toContain('skipWaiting');
  });

  it('does not call skipWaiting during install', () => {
    // The §3.9 rule, stated as directly as it can be.
    expect(
      handler('install'),
      'skipWaiting() in install: a new build would seize a page mid-SITREP',
    ).not.toContain('skipWaiting');
  });

  it('does not call skipWaiting during activate either', () => {
    // Not in §3.9's words, but the same effect one event later.
    expect(handler('activate')).not.toContain('skipWaiting');
  });

  it('takes over only when the page sends the message', () => {
    // What makes "offers, does not impose" true rather than aspirational: the waiting worker
    // cannot activate itself, so the decision belongs to the man looking at the screen.
    const message = handler('message');
    expect(message).toContain('etm-apply-update');
    expect(message).toContain('skipWaiting');
  });

  it('never caches anything about a member', () => {
    // §3.5 and §3.8 together. A cached Supabase response leaves protocol detail, revenue and
    // Bottom G tactics on disk, unencrypted, surviving sign-out — somewhere `clearUserState`
    // cannot reach.
    const fetchHandler = handler('fetch');
    expect(fetchHandler).toContain("startsWith('/rest/')");
    expect(fetchHandler).toContain("startsWith('/auth/')");
    // And cross-origin requests, which is where Supabase actually lives.
    expect(fetchHandler).toContain('url.origin !== self.location.origin');
  });

  it('only handles GET, so no write is ever replayed from a cache', () => {
    expect(handler('fetch')).toContain("request.method !== 'GET'");
  });

  it('goes to the network first, and falls back rather than leading with the cache', () => {
    // Cache-first on the shell means a man can be looking at a build two versions old with no
    // way to tell. Network-first with a cache fallback is the honest order for an app whose
    // offline story is the outbox rather than the cache.
    const fetchHandler = handler('fetch');
    const network = fetchHandler.indexOf('fetch(request)');
    const cache = fetchHandler.indexOf('caches.match');
    expect(network).toBeGreaterThan(-1);
    expect(cache).toBeGreaterThan(network);
  });
});
