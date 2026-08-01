import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSTGREST_VERSION } from '../../scripts/db/postgrest.ts';

/**
 * The local PostgREST and CI's PostgREST are the same PostgREST.
 *
 * The version is necessarily in two places: `scripts/db/postgrest.ts` downloads it for a
 * developer, and the CI workflow installs it as a cached step where it is also the cache
 * key. Neither can read the other.
 *
 * Left unpinned, they drift — and then the end-to-end suite passes locally against one
 * server and fails in CI against another, or worse, passes in both while testing different
 * behaviour. That is the same shape as the gap the suite was built to close: two things that
 * are supposed to agree, with nothing checking that they do.
 */
describe('the PostgREST pin', () => {
  it('matches the version CI installs', () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    const match = workflow.match(/POSTGREST_VERSION:\s*'([^']+)'/);

    expect(match, 'ci.yml no longer sets POSTGREST_VERSION').not.toBeNull();
    expect(
      match?.[1],
      'ci.yml and scripts/db/postgrest.ts disagree on the PostgREST version',
    ).toBe(POSTGREST_VERSION);
  });

  it('is a pinned release, not a moving tag', () => {
    // `latest` would make a CI failure impossible to reproduce a week later, and would
    // silently change what the security assertions in tests/api are asserting against.
    expect(POSTGREST_VERSION).toMatch(/^v\d+\.\d+(\.\d+)?$/);
  });
});
