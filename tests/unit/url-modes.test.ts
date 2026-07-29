import { describe, expect, it } from 'vitest';
import { buildJoinUrl, isJoinUrl } from '@/lib/join-url';
import { isRecoveryUrl } from '@/features/auth/recovery';

/**
 * Cross-cutting: the two things read from the URL at first paint.
 *
 * Lives in tests/unit rather than beside either module because it deliberately reaches into
 * both, and a test colocated in `lib` that imports a feature is the layering violation the
 * import-graph test exists to catch — even though nothing at runtime would be affected.
 */
describe('join and recovery URL modes do not collide', () => {
  it('a join link is not a recovery link, and vice versa', () => {
    // A shared parameter or an accidental overlap would let one hijack the other's screen.
    expect(isRecoveryUrl(buildJoinUrl('https://x.example.com'))).toBe(false);
    expect(isJoinUrl('https://x.example.com/?mode=reset')).toBe(false);
    expect(isJoinUrl('https://x.example.com/#access_token=a&type=recovery')).toBe(false);
  });

  it('both can be present, and recovery is the one that wins', () => {
    // The precedence itself is enforced in resolveAuthView and tested exhaustively there;
    // this records that the detectors genuinely both fire, so that precedence is load-bearing
    // rather than incidental.
    const both = 'https://x.example.com/?join=1&mode=reset';
    expect(isJoinUrl(both)).toBe(true);
    expect(isRecoveryUrl(both)).toBe(true);
  });
});
