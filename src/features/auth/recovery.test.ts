import { describe, expect, it } from 'vitest';
import {
  buildRecoveryRedirectUrl,
  isRecoveryUrl,
  RECOVERY_PARAM,
  RECOVERY_VALUE,
  stripRecoveryFromUrl,
} from '@/features/auth/recovery';

describe('buildRecoveryRedirectUrl', () => {
  it('tags the URL with a parameter we control', () => {
    // Ours, not Supabase's: it is readable from window.location before the auth library
    // has exchanged the token, which is the only way to pin the reset view at first paint.
    const url = buildRecoveryRedirectUrl('https://etm.example.com');
    expect(new URL(url).searchParams.get(RECOVERY_PARAM)).toBe(RECOVERY_VALUE);
    expect(isRecoveryUrl(url)).toBe(true);
  });

  it('preserves an existing path', () => {
    const url = buildRecoveryRedirectUrl('https://etm.example.com/app');
    expect(new URL(url).pathname).toBe('/app');
    expect(isRecoveryUrl(url)).toBe(true);
  });
});

describe('isRecoveryUrl', () => {
  it('detects our own parameter', () => {
    expect(isRecoveryUrl('https://x.example.com/?mode=reset')).toBe(true);
  });

  it('detects type=recovery in the query, as PKCE sends it', () => {
    expect(isRecoveryUrl('https://x.example.com/?type=recovery&code=abc')).toBe(true);
  });

  it('detects type=recovery in the hash, as the implicit flow sends it', () => {
    // Supabase historically puts the token in the fragment. Missing this would let a
    // recovery link land on the dashboard.
    expect(
      isRecoveryUrl('https://x.example.com/#access_token=abc&type=recovery&expires_in=3600'),
    ).toBe(true);
  });

  it('is false for ordinary URLs', () => {
    for (const href of [
      'https://x.example.com/',
      'https://x.example.com/?mode=signin',
      'https://x.example.com/?type=signup',
      'https://x.example.com/#access_token=abc&type=magiclink',
      'https://x.example.com/?modest=reset',
    ]) {
      expect(isRecoveryUrl(href), href).toBe(false);
    }
  });

  it('is false rather than throwing for a malformed URL', () => {
    // A crash here would blank the app on first paint.
    expect(isRecoveryUrl('not a url')).toBe(false);
    expect(isRecoveryUrl('')).toBe(false);
  });
});

describe('stripRecoveryFromUrl', () => {
  it('removes every marker so a reload does not re-enter recovery', () => {
    const stripped = stripRecoveryFromUrl(
      'https://x.example.com/app?mode=reset&type=recovery&keep=1#access_token=abc&type=recovery',
    );
    expect(isRecoveryUrl(stripped)).toBe(false);
    // Unrelated parameters survive — stripping the whole query would lose app state.
    expect(new URL(stripped).searchParams.get('keep')).toBe('1');
    expect(new URL(stripped).pathname).toBe('/app');
  });

  it('is only safe to call after the password actually changed', () => {
    // Documented as an assertion: stripping on mount would mean a reload mid-reset drops
    // the person into the app holding the session the link created.
    const before = 'https://x.example.com/?mode=reset';
    expect(isRecoveryUrl(before)).toBe(true);
    expect(isRecoveryUrl(stripRecoveryFromUrl(before))).toBe(false);
  });
});
