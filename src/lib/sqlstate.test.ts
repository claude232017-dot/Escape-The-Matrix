import { describe, expect, it } from 'vitest';
import { classifyFailure, classifySqlstate, sqlstateOf } from '@/lib/sqlstate';

describe('the failure this module prevents', () => {
  it('classifies 42501 — an RLS permission denial — as permanent', () => {
    // The named bug: prose matching reads "permission denied" as a network blip and retries it
    // for ever in silence. The man's report never lands and nothing tells him.
    expect(classifySqlstate('42501')).toBe('permanent');
  });

  it('does not consult the message text at all', () => {
    // Two failures with identical, network-sounding messages and different codes must classify
    // differently. If the message mattered, both would be retried.
    const permanent = { code: '23505', message: 'connection failed, please retry' };
    const transient = { code: '08006', message: 'connection failed, please retry' };
    expect(classifyFailure(permanent)).toBe('permanent');
    expect(classifyFailure(transient)).toBe('transient');
  });
});

describe('permanent classes — waiting cannot help', () => {
  it.each([
    ['22001', 'string_data_right_truncation — a capped field overflowed'],
    ['22007', 'invalid_datetime_format'],
    ['22P02', 'invalid_text_representation'],
    ['23502', 'not_null_violation'],
    ['23503', 'foreign_key_violation'],
    ['23505', 'unique_violation — a second SITREP for the same day'],
    ['23514', 'check_violation — a future-dated SITREP'],
    ['42501', 'insufficient_privilege — RLS'],
    ['42703', 'undefined_column'],
    ['42P01', 'undefined_table'],
  ])('%s is permanent (%s)', (code) => {
    expect(classifySqlstate(code)).toBe('permanent');
  });
});

describe('transient classes — waiting plausibly helps', () => {
  it.each([
    ['08006', 'connection_failure'],
    ['08003', 'connection_does_not_exist'],
    ['53300', 'too_many_connections'],
    ['57014', 'query_canceled'],
    ['57P01', 'admin_shutdown'],
    ['58030', 'io_error'],
  ])('%s is transient (%s)', (code) => {
    expect(classifySqlstate(code)).toBe('transient');
  });

  it('treats serialisation failure and deadlock as transient despite their class', () => {
    // Class 40 reads as permanent — transaction rollback — but these two are the textbook retry
    // case: a second attempt succeeds. Classifying by class alone would give up on both.
    expect(classifySqlstate('40001')).toBe('transient');
    expect(classifySqlstate('40P01')).toBe('transient');
    // The rest of class 40 is not special-cased and stays unknown, which is retried but bounded.
    expect(classifySqlstate('40002')).toBe('unknown');
  });
});

describe('unknown', () => {
  it('is the answer for an unrecognised code, an absent one, and rubbish', () => {
    // Retried but bounded. The two ways to be wrong are not symmetric: giving up loses one
    // report, retrying for ever loses the report AND hides that it was lost.
    for (const code of [null, undefined, '', '   ', 'P0001', '99999', 'nonsense']) {
      expect(classifySqlstate(code), String(code)).toBe('unknown');
    }
  });

  it('is the answer for a network failure, which has no SQLSTATE', () => {
    // A fetch that never reached the server is exactly what the queue exists for, so `unknown`
    // being retried is the behaviour we want here.
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('unknown');
    expect(classifyFailure({ message: 'NetworkError when attempting to fetch resource.' })).toBe(
      'unknown',
    );
  });

  it('is case-insensitive about the code it does recognise', () => {
    expect(classifySqlstate('40p01')).toBe('transient');
    expect(classifySqlstate('42p01')).toBe('permanent');
  });
});

describe('sqlstateOf', () => {
  it('reads the code supabase-js and node-postgres both use', () => {
    expect(sqlstateOf({ code: '23505', message: 'duplicate key' })).toBe('23505');
  });

  it('unwraps a nested cause', () => {
    expect(sqlstateOf({ message: 'wrapped', cause: { code: '08006' } })).toBe('08006');
  });

  it('ignores codes that are not SQLSTATEs', () => {
    // `ECONNREFUSED` and an HTTP status both live in `code` on other error types. Treating them
    // as SQLSTATEs would classify by accident — `50000`-shaped nonsense could look transient.
    expect(sqlstateOf({ code: 'ECONNREFUSED' })).toBeNull();
    expect(sqlstateOf({ code: 500 })).toBeNull();
    expect(sqlstateOf({ code: '500' })).toBeNull();
    expect(sqlstateOf(null)).toBeNull();
    expect(sqlstateOf('a string')).toBeNull();
  });

  it('trims whitespace around an otherwise valid code', () => {
    expect(sqlstateOf({ code: ' 23505 ' })).toBe('23505');
  });
});
