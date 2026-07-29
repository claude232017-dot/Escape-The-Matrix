import { describe, expect, it } from 'vitest';
import { describeCrash } from '@/app/crash-report';

describe('describeCrash', () => {
  it('never leaves the technical line empty, whatever it was handed', () => {
    // The failure mode being avoided is the one from the auth mapper: a crash screen that
    // shows nothing useful is a crash screen that cannot be reported.
    for (const thrown of [null, undefined, {}, '', '   ', '{}', 0, new Error('')]) {
      const report = describeCrash(thrown);
      expect(report.technical.trim(), JSON.stringify(thrown)).not.toBe('');
      expect(report.technical).not.toBe('{}');
      expect(report.title.length).toBeGreaterThan(0);
      expect(report.detail.length).toBeGreaterThan(20);
    }
  });

  it('tells him his filed work is safe, in every case', () => {
    // The first question anyone has when a screen vanishes is "did I just lose that?".
    for (const thrown of [
      new Error('Cannot read properties of undefined'),
      new Error('Failed to fetch'),
      new Error('Failed to fetch dynamically imported module: /assets/x.js'),
    ]) {
      // Matched on the claim rather than a turn of phrase: every branch must say something
      // about what happened to work already filed, however it words it.
      expect(describeCrash(thrown).detail).toMatch(
        /nothing you have (already )?filed is (lost|affected)/i,
      );
    }
  });

  it('recognises a stale deploy and explains it as such', () => {
    // The commonest crash in a long-lived tab, and the only one with a cause worth naming:
    // the chunk it wants was replaced by a deploy.
    const report = describeCrash(
      new Error('Failed to fetch dynamically imported module: /assets/index-abc.js'),
    );
    expect(report.title).toMatch(/updated/i);
    expect(report.detail).toMatch(/newer version/i);
    expect(report.reloadLikelyHelps).toBe(true);
  });

  it('recognises a network failure', () => {
    const report = describeCrash(new TypeError('Failed to fetch'));
    expect(report.title).toMatch(/connection/i);
    expect(report.detail).toMatch(/connection/i);
  });

  it('does not blame the member for an ordinary bug', () => {
    const report = describeCrash(new Error("Cannot read properties of null (reading 'map')"));
    expect(report.detail).toMatch(/not something you did/i);
    expect(report.technical).toContain('Cannot read properties of null');
  });

  it('falls back to the error name when there is no message', () => {
    const report = describeCrash({ name: 'ChunkLoadError', message: '' });
    expect(report.technical).toBe('ChunkLoadError');
  });

  it('accepts a bare string throw', () => {
    expect(describeCrash('everything is on fire').technical).toBe('everything is on fire');
  });
});
