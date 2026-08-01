import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_IDENTIFIERS,
  componentNames,
  identifierIn,
  report,
  routeOf,
  toReport,
} from '@/lib/egress';

/**
 * §3.5, tested the way it is written: *"Scrub it at the boundary and **test that you did**."*
 *
 * The test that matters is the last one in this file. It takes every kind of thing a member
 * types into this app — the sentence the Bottom G used on him, what he committed to, a payment,
 * his own creed — buries each one somewhere plausible in an error, and asserts that none of it
 * survives into the payload a third party would receive.
 *
 * Everything above that is scaffolding for it.
 */

/** Real strings, in the words the doctrine actually uses. Nothing here may ever leave. */
const MEMBER_DATA = [
  'You have earned a break', // bottom_g_tactics.propaganda
  'Laying gym clothes out the night before', // debriefs.system_used
  'Out the door before the Bottom G could negotiate', // debriefs.victory
  'Ten sales calls before Friday', // commitments.body
  'First retainer', // money_entries.note
  '125000', // money_entries.amount_minor
  'Discipline equals freedom', // profiles.top_g_code
  'member-a@example.com',
  'Marcus Aurelius',
  'sexual-discipline', // a protocol slug — which one he failed
];

describe('the payload is constructed, not filtered', () => {
  it('copies nothing it was not asked for', () => {
    // The load-bearing property. A denylist is wrong the moment somebody adds a column; this
    // builds a fixed shape, so an unknown field cannot ride along.
    const cause = Object.assign(new Error('commitments_ceiling'), {
      code: '23514',
      details: "Failing row contains (…, 'Ten sales calls before Friday', …)",
      hint: 'Three commitments in a week is the cap.',
      propaganda: 'You have earned a break',
    });

    const payload = toReport(cause, { pathname: '/' });

    expect(Object.keys(payload).sort()).toEqual([
      'at',
      'code',
      'componentStack',
      'identifier',
      'name',
      'route',
      'schemaVersion',
    ]);
  });

  it('keeps the class and the SQLSTATE, which are not data', () => {
    const cause = Object.assign(new TypeError('commitment_too_early'), { code: 'P0001' });
    const payload = toReport(cause);
    expect(payload.name).toBe('TypeError');
    expect(payload.code).toBe('P0001');
  });

  it('refuses anything that is not a five-character SQLSTATE', () => {
    // `code` is a conventional field name; a vendor SDK could put anything in it.
    for (const code of ['Ten sales calls', '', '2351', 'not-a-code', 42]) {
      expect(toReport(Object.assign(new Error('x'), { code })).code).toBeNull();
    }
  });
});

describe('the message', () => {
  it('is reduced to an identifier this repository chose', () => {
    // Substring, because Postgres wraps it: only the identifier comes out, never the wrapper.
    expect(
      identifierIn(
        'new row for relation "commitments" violates check constraint "commitments_body_not_blank"',
      ),
    ).toBe('commitments_body_not_blank');
  });

  it('is dropped entirely when it is not one', () => {
    // The default, and the reason the boundary is safe: an unrecognised message is assumed to
    // be data, because usually it is.
    for (const raw of MEMBER_DATA) {
      expect(identifierIn(raw), `"${raw}" survived as an identifier`).toBeNull();
    }
    expect(identifierIn('Failing row contains (Ten sales calls)')).toBeNull();
    expect(identifierIn(undefined)).toBeNull();
  });

  it('does not accept a member’s text merely for looking like an identifier', () => {
    // The reason the list is explicit rather than a pattern. `[a-z_]+` would accept this.
    expect(identifierIn('ten_sales_calls_before_friday')).toBeNull();
    expect(identifierIn('you_have_earned_a_break')).toBeNull();
  });
});

describe('the route', () => {
  it('is a shape, never a pathname', () => {
    expect(routeOf('/')).toBe('app');
    expect(routeOf('/harness/sitrep')).toBe('harness');
    expect(routeOf('/auth/callback')).toBe('auth');
  });

  it('reports an unrecognised path as unknown rather than passing it through', () => {
    // The day somebody adds /member/:id, this keeps the id out of the payload without anybody
    // having to remember that this file exists.
    expect(routeOf('/member/8f14e45f-ceea-467a-9f4e-1f2c3d4e5f60')).toBe('unknown');
  });
});

describe('the component stack', () => {
  it('keeps component names and nothing else', () => {
    const stack = [
      '    in SitrepForm (at ForgeScreen.tsx:120)',
      '    in ForgeScreen (at /home/builder/secret-path/src/app/SignedInShell.tsx:98)',
    ].join('\n');
    const names = componentNames(stack);
    expect(names).toBe('SitrepForm < ForgeScreen');
    expect(names).not.toContain('secret-path');
    expect(names).not.toContain('.tsx');
  });

  it('is null when there is nothing to keep', () => {
    expect(componentNames(undefined)).toBeNull();
    expect(componentNames('')).toBeNull();
  });
});

describe('the identifier list stays in step with the migrations', () => {
  it('names only identifiers the schema actually raises', () => {
    // Drift in the safe direction is harmless — an identifier that no longer exists simply
    // never matches. Drift the other way is not: an identifier the schema raises but this list
    // does not know becomes a dropped message, which costs debuggability rather than safety.
    // So this asserts the list is a *subset*, and reports what the schema has that it lacks.
    const dir = new URL('../../supabase/migrations', import.meta.url).pathname;
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');

    const stale = [...KNOWN_IDENTIFIERS].filter((id) => !sql.includes(id));
    expect(stale, `identifiers no migration defines: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('nothing a member typed ever leaves', () => {
  it('survives none of it, wherever it is hidden in the error', () => {
    // The §3.5 test. Each string is planted in every field a careless reporter would send —
    // message, details, hint, and an arbitrary extra property — and the whole payload is
    // searched for it afterwards.
    for (const secret of MEMBER_DATA) {
      const cause = Object.assign(new Error(`commitments_ceiling: ${secret}`), {
        code: '23514',
        details: `Failing row contains (${secret})`,
        hint: secret,
        note: secret,
        payload: { nested: { deeper: secret } },
      });

      const payload = report(cause, {
        pathname: `/member/${secret}`,
        componentStack: `    in SitrepForm (at ${secret}.tsx:1)`,
        schemaVersion: 12,
      });

      const serialised = JSON.stringify(payload);
      expect(serialised, `"${secret}" reached the outgoing payload`).not.toContain(secret);
    }
  });

  it('still says enough to be worth sending', () => {
    // A boundary that redacted everything would be safe and useless, and somebody would route
    // around it within a week. A class, a SQLSTATE, an identifier and a route is a diagnosis.
    const payload = report(
      Object.assign(new Error('violates check constraint "commitments_ceiling"'), {
        code: '23514',
      }),
      { pathname: '/', componentStack: '    in WeekForm (at x.tsx:1)', schemaVersion: 12 },
    );

    expect(payload).toMatchObject({
      name: 'Error',
      code: '23514',
      identifier: 'commitments_ceiling',
      route: 'app',
      componentStack: 'WeekForm',
      schemaVersion: 12,
    });
  });
});
