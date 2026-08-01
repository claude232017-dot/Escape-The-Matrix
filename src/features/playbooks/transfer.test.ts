import { describe, expect, it } from 'vitest';
import {
  TRANSFER_MINIMUM,
  answered,
  applicationKey,
  canAdopt,
  catalogue,
  owesAnswer,
  verdict,
  type Application,
  type Playbook,
  type Transfer,
} from '@/features/playbooks/transfer';

function transfer(over: Partial<Transfer> = {}): Transfer {
  return { playbookId: 'p1', adopted: 0, held: 0, didNot: 0, pending: 0, ...over };
}

function playbook(over: Partial<Playbook> = {}): Playbook {
  return {
    id: 'p1',
    title: 'Clothes out the night before',
    body: 'Lay the kit out before bed',
    protocolId: null,
    isActive: true,
    promotedFrom: null,
    ...over,
  };
}

describe('the verdict', () => {
  it('refuses to claim anything under three answers', () => {
    // The correct answer for most of a campaign, and a first-class one rather than an error.
    expect(verdict(transfer({ held: 2, didNot: 0 }))).toBe('untested');
    expect(verdict(transfer({ held: 0, didNot: 2 }))).toBe('untested');
    expect(verdict(transfer())).toBe('untested');
  });

  it('says a system travels when it held for most who tried it', () => {
    expect(verdict(transfer({ held: 3, didNot: 0 }))).toBe('travels');
    expect(verdict(transfer({ held: 4, didNot: 2 }))).toBe('travels');
  });

  it('is willing to say a system is personal', () => {
    // The uncomfortable finding, and the more useful one: it tells a man the system did not
    // work for him because it is not general, rather than because he is weak. An engine that
    // could only produce the flattering answer would not be worth having.
    expect(verdict(transfer({ held: 0, didNot: 3 }))).toBe('personal');
    expect(verdict(transfer({ held: 2, didNot: 4 }))).toBe('personal');
  });

  it('says mixed rather than picking a side on a tie', () => {
    expect(verdict(transfer({ held: 2, didNot: 2 }))).toBe('mixed');
  });

  it('does not count pending adoptions against a playbook', () => {
    // Otherwise a system looks worse the more people are currently trying it, which is exactly
    // backwards. Two answers plus four in flight is still two answers.
    expect(verdict(transfer({ held: 2, didNot: 0, pending: 4 }))).toBe('untested');
    expect(answered(transfer({ held: 2, didNot: 0, pending: 4 }))).toBe(2);
  });

  it('crosses the threshold on answers, not on adoptions', () => {
    const nearly = transfer({ held: 1, didNot: 1, pending: 9 });
    expect(answered(nearly)).toBeLessThan(TRANSFER_MINIMUM);
    expect(verdict(nearly)).toBe('untested');

    const enough = transfer({ held: 2, didNot: 1, pending: 9 });
    expect(verdict(enough)).toBe('travels');
  });
});

describe('the catalogue order', () => {
  it('is not sorted by adoption or by verdict', () => {
    // Ordering by popularity is the leaderboard §1 rules out; ordering by verdict buries the
    // systems that did not travel, which are the ones carrying the most information.
    const order = ['a', 'b', 'c'];
    const sorted = catalogue(
      [playbook({ id: 'c' }), playbook({ id: 'a' }), playbook({ id: 'b' })],
      order,
    );
    expect(sorted.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts retired playbooks last without removing them', () => {
    // Retired rather than deleted: a man who adopted it has it in his record.
    const sorted = catalogue(
      [playbook({ id: 'old', isActive: false }), playbook({ id: 'live' })],
      ['old', 'live'],
    );
    expect(sorted.map((p) => p.id)).toEqual(['live', 'old']);
  });

  it('is stable when nothing distinguishes two playbooks', () => {
    const given = [playbook({ id: 'x' }), playbook({ id: 'y' })];
    expect(catalogue(given, ['x', 'y']).map((p) => p.id)).toEqual(['x', 'y']);
  });
});

describe('adopting', () => {
  const mine: Application[] = [
    { id: 'a1', playbookId: 'p1', outcome: 'pending', adoptedOn: '2026-07-27' },
  ];

  it('refuses a second adoption of the same playbook', () => {
    // Mirror: applications_one_per_man. Without it a man could move a transfer rate alone.
    expect(canAdopt(playbook({ id: 'p1' }), mine)).toBe(false);
    expect(canAdopt(playbook({ id: 'p2' }), mine)).toBe(true);
  });

  it('refuses a settled one just as firmly as a pending one', () => {
    const settled: Application[] = [
      { id: 'a1', playbookId: 'p1', outcome: 'did_not', adoptedOn: '2026-07-27' },
    ];
    expect(canAdopt(playbook({ id: 'p1' }), settled)).toBe(false);
  });

  it('refuses a retired playbook', () => {
    expect(canAdopt(playbook({ id: 'p9', isActive: false }), [])).toBe(false);
  });

  it('knows which ones he still owes an answer on', () => {
    expect(owesAnswer(mine, 'p1')).toBe(true);
    expect(owesAnswer(mine, 'p2')).toBe(false);
    expect(
      owesAnswer([{ id: 'a1', playbookId: 'p1', outcome: 'held', adoptedOn: '2026-07-27' }], 'p1'),
    ).toBe(false);
  });
});

describe('outbox keys', () => {
  it('gives one slot per playbook, so answering three does not coalesce into one', () => {
    expect(applicationKey('p1')).not.toBe(applicationKey('p2'));
    expect(applicationKey('p1')).toBe(applicationKey('p1'));
  });
});
