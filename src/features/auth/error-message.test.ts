import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '@/features/auth/error-message';

describe('the bug this module was written for', () => {
  it('never puts "{}" on screen', () => {
    // This is what actually happened: cause.message was the literal string "{}", no pattern
    // matched, and it was returned verbatim. A real signup failure was reported as two
    // braces, which tells the person nothing except that something is broken.
    const message = authErrorMessage({ message: '{}' });
    expect(message).not.toBe('{}');
    expect(message).not.toContain('{}');
    expect(message.length).toBeGreaterThan(20);
  });

  it('treats every empty-looking shape as absent', () => {
    for (const empty of ['{}', '[]', '', '   ', 'null', 'undefined', '[object Object]']) {
      const message = authErrorMessage({ message: empty });
      // Only meaningful for shapes that have visible characters to leak; `not.toContain('')`
      // can never pass, so asserting it would be testing nothing.
      if (empty.trim() !== '') {
        expect(message, `leaked ${JSON.stringify(empty)}`).not.toContain(empty.trim());
      }
      expect(message).toMatch(/no reason|without explaining/i);
    }
  });

  it('quotes a status or code when there is nothing readable, so it stays diagnosable', () => {
    // "It said {}" cannot be investigated. "It said status 500" can.
    expect(authErrorMessage({ message: '{}', status: 500 })).toContain('status 500');
    expect(authErrorMessage({ message: '', error_code: 'unexpected_failure' })).toContain(
      'unexpected_failure',
    );
    expect(authErrorMessage({})).toMatch(/gave no reason/i);
  });
});

describe('finding the text GoTrue actually used', () => {
  it('reads message, msg, error_description, error, details and hint', () => {
    // Depending on endpoint and version the human-readable text lands in different fields.
    // Looking only at `message` is why nothing matched and "{}" got through.
    expect(authErrorMessage({ msg: 'Invalid login credentials' })).toBe(
      'That email and password do not match.',
    );
    expect(authErrorMessage({ error_description: 'Email not confirmed' })).toBe(
      'Confirm your email address first.',
    );
    expect(authErrorMessage({ error: 'User already registered' })).toContain('already an account');
    expect(authErrorMessage({ hint: 'signup_requires_invitation' })).toContain('no live invitation');
  });

  it('prefers the most specific field when several are present', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials', hint: 'something else' })).toBe(
      'That email and password do not match.',
    );
  });

  it('unwraps a nested error', () => {
    expect(authErrorMessage({ cause: { message: 'Email not confirmed' } })).toBe(
      'Confirm your email address first.',
    );
    expect(authErrorMessage({ error: { msg: 'Invalid login credentials' } })).toBe(
      'That email and password do not match.',
    );
  });

  it('accepts a bare string', () => {
    expect(authErrorMessage('Invalid login credentials')).toBe(
      'That email and password do not match.',
    );
  });
});

describe('the invite rejection, which GoTrue masks', () => {
  it('maps the opaque database error to the likely cause', () => {
    // GoTrue turns any trigger error into this one string, so the trigger's own message
    // almost never reaches the browser.
    const message = authErrorMessage({ message: 'Database error saving new user' });
    expect(message).toContain('no live invitation');
    // Hedged deliberately: it is the likely cause, not a confirmed one, and confirming it
    // would require an endpoint that leaks who is in the circle.
    expect(message).toContain('most likely');
  });

  it('also maps the unexpected_failure code GoTrue pairs with it', () => {
    expect(authErrorMessage({ message: 'unexpected_failure' })).toContain('no live invitation');
  });

  it('names the exact-address trap, which is the commonest mistake', () => {
    expect(authErrorMessage({ message: 'Database error saving new user' })).toMatch(
      /exactly this address/i,
    );
  });

  it('passes the unmasked trigger message straight through when it does arrive', () => {
    expect(authErrorMessage({ message: 'signup_requires_invitation' })).toBe(
      'That address has no live invitation. Ask the mentor for one.',
    );
  });
});

describe('other conditions worth naming', () => {
  it('explains disabled sign-ups as a project setting, not the member’s fault', () => {
    expect(authErrorMessage({ message: 'Signups not allowed for this instance' })).toContain(
      'switched off',
    );
  });

  it('recognises rate limiting and network failure', () => {
    expect(authErrorMessage({ message: 'email rate limit exceeded' })).toContain('Too many attempts');
    expect(authErrorMessage({ message: 'Failed to fetch' })).toContain('Could not reach the server');
  });

  it('does not leak a policy expression to the member', () => {
    // A Postgres RLS message can name tables and columns and tells the person nothing useful.
    const message = authErrorMessage({
      message: 'new row violates row-level security policy for table "profiles"',
    });
    expect(message).toBe('You do not have access to that.');
    expect(message).not.toContain('profiles');
  });

  it('passes an unrecognised but readable message through unchanged', () => {
    // Better an unfamiliar true statement than a reassuring generic one.
    expect(authErrorMessage({ message: 'Weak password: too short' })).toBe(
      'Weak password: too short',
    );
  });
});
