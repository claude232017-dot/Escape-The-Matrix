import { describe, expect, it } from 'vitest';
import { buildJoinUrl, isJoinUrl, JOIN_PARAM } from '@/lib/join-url';

describe('buildJoinUrl', () => {
  it('tags the URL so an invitation email lands on setup', () => {
    const url = buildJoinUrl('https://etm.example.com');
    expect(new URL(url).searchParams.get(JOIN_PARAM)).toBe('1');
    expect(isJoinUrl(url)).toBe(true);
  });

  it('carries no authority — it is a convenience, not a credential', () => {
    // Documented as a test because the tempting "improvement" is to put the invitation token
    // in this link. The URL is pasted into chat; a token there is a credential in a place
    // credentials leak, and it would buy nothing because the trigger checks the email.
    expect(buildJoinUrl('https://etm.example.com')).not.toMatch(/token|secret|[0-9a-f]{32}/);
  });
});

describe('isJoinUrl', () => {
  it('recognises the parameter and nothing near it', () => {
    expect(isJoinUrl('https://x.example.com/?join=1')).toBe(true);
    expect(isJoinUrl('https://x.example.com/')).toBe(false);
    expect(isJoinUrl('https://x.example.com/?join=0')).toBe(false);
    expect(isJoinUrl('https://x.example.com/?joining=1')).toBe(false);
  });

  it('is false rather than throwing for a malformed URL', () => {
    expect(isJoinUrl('not a url')).toBe(false);
  });
});
