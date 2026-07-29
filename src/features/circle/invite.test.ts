import { describe, expect, it } from 'vitest';
import {
  generateInvitationToken,
  invitationExpiry,
  INVITATION_TTL_DAYS,
} from '@/features/circle/invite';

describe('generateInvitationToken', () => {
  it('produces 32 hex characters, within the SQL length constraint', () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    // SQL: invitations_token_length checks 16..128.
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token.length).toBeLessThanOrEqual(128);
  });

  it('does not repeat across many draws', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateInvitationToken()));
    expect(tokens.size).toBe(2000);
  });

  it('uses the injected source, so the CSPRNG dependency is explicit and testable', () => {
    // Proves the bytes come from the source rather than anywhere else — which is what makes
    // "never Math.random" an enforceable claim rather than a comment.
    const token = generateInvitationToken((array) => {
      array.fill(0xab);
      return array;
    });
    expect(token).toBe('ab'.repeat(16));
  });
});

describe('invitationExpiry', () => {
  it('is the configured number of days out', () => {
    const from = new Date('2026-07-29T12:00:00Z');
    const expiry = new Date(invitationExpiry(from));
    expect((expiry.getTime() - from.getTime()) / 86_400_000).toBe(INVITATION_TTL_DAYS);
  });

  it('is in the future, which the SQL CHECK requires', () => {
    // SQL: invitations_expiry_after_creation.
    expect(new Date(invitationExpiry()).getTime()).toBeGreaterThan(Date.now());
  });
});
