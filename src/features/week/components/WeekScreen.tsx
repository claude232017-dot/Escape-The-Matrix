import { useCallback, useRef, useState } from 'react';
import type { OutboxEntry } from '@/lib/outbox';
import { describeQueue, useOutbox } from '@/lib/use-outbox';
import {
  MAX_COMMITMENTS,
  declareKey,
  settleKey,
  toPayload,
  type DeclarePayload,
} from '@/features/week/commitment-draft';
import {
  commitmentRefusalMessage,
  sendCommitments,
  sendSettlement,
  withdrawCommitment,
  type SettlePayload,
} from '@/features/week/commitment-write';
import { WeekForm, type WeekState } from '@/features/week/components/WeekForm';
import type { WeekData, WeekLoaded } from '@/features/week/use-week-data';

/**
 * The week, wired to the database.
 *
 * Takes its data as a prop — loaded once by the shell, per the lesson in
 * @/features/forge/use-forge-data. The import-graph test asserts ForgeScreen and LedgerScreen do
 * not fetch; this one follows the same rule, and the withdrawal below is the single exception
 * worth explaining rather than a habit creeping back.
 */

export interface WeekScreenProps {
  data: WeekData;
  profileId: string;
}

export function WeekScreen({ data, profileId }: WeekScreenProps) {
  const { loaded, error, localDate, weekStart, reload } = data;

  const [drafts, setDrafts] = useState<string[]>(Array<string>(MAX_COMMITMENTS).fill(''));
  const [state, setState] = useState<WeekState>('idle');
  const [refusal, setRefusal] = useState<string | null>(null);

  const send = useCallback(async (entry: OutboxEntry) => {
    if (entry.key.startsWith('settle:')) {
      await sendSettlement(entry.payload as SettlePayload);
      return;
    }
    await sendCommitments(entry.payload as DeclarePayload);
  }, []);
  const outbox = useOutbox(profileId, send);

  // Adopt the loaded week during render rather than in an effect — see ForgeScreen for why.
  const [adopted, setAdopted] = useState<WeekLoaded | null>(null);
  if (loaded !== adopted) {
    setAdopted(loaded);
    // Clearing the drafts on a fresh load is what stops a successful declaration leaving its own
    // text sitting in the boxes underneath it, which reads as though nothing was saved.
    if (loaded && loaded.current.commitments.length > 0) {
      setDrafts(Array<string>(MAX_COMMITMENTS).fill(''));
    }
  }

  const onDraft = useCallback((index: number, value: string) => {
    setDrafts((current) => current.map((v, i) => (i === index ? value : v)));
    setState('idle');
    setRefusal(null);
  }, []);

  const declaring = useRef(false);

  const onDeclare = useCallback(async () => {
    if (declaring.current) return;
    const payload = toPayload(weekStart, drafts);
    if (!payload) return;

    declaring.current = true;
    setState('working');
    setRefusal(null);
    try {
      const outcome = await outbox.queue(declareKey(weekStart), payload);
      if (outcome.sent) {
        setState('sent');
        reload();
      } else if (outcome.refused) {
        setState('refused');
        setRefusal(commitmentRefusalMessage(outcome.failure?.message ?? 'Unknown reason'));
      } else if (outcome.lost) {
        setState('lost');
      } else {
        setState('held');
      }
    } finally {
      declaring.current = false;
    }
  }, [drafts, outbox, reload, weekStart]);

  const onSettle = useCallback(
    async (id: string, answer: 'hit' | 'missed') => {
      setRefusal(null);
      const outcome = await outbox.queue(settleKey(id), { id, outcome: answer });
      if (outcome.sent) reload();
      else if (outcome.refused) {
        setRefusal(commitmentRefusalMessage(outcome.failure?.message ?? 'Unknown reason'));
      }
    },
    [outbox, reload],
  );

  const onWithdraw = useCallback(
    async (id: string) => {
      // Not through the outbox — see withdrawCommitment for why.
      setRefusal(null);
      try {
        await withdrawCommitment(id);
      } catch (cause) {
        setRefusal(commitmentRefusalMessage(cause));
        return;
      }
      reload();
    },
    [reload],
  );

  if (error) {
    return (
      <Panel>
        <p role="alert" className="text-sm text-status-fail">
          {error}
        </p>
      </Panel>
    );
  }

  if (!loaded) {
    return (
      <Panel>
        <p aria-busy="true" className="text-sm text-text-muted">
          Loading the week…
        </p>
      </Panel>
    );
  }

  return (
    <WeekForm
      current={loaded.current}
      previous={loaded.previous}
      circle={loaded.circle}
      profileId={profileId}
      today={localDate}
      drafts={drafts}
      state={state}
      statusMessage={
        state === 'sent' && outbox.status.state === 'empty'
          ? 'Declared. It is on the server.'
          : state === 'idle'
            ? 'Not declared yet.'
            : describeQueue(outbox)
      }
      refusal={refusal}
      onDraft={onDraft}
      onDeclare={() => void onDeclare()}
      onWithdraw={(id) => void onWithdraw(id)}
      onSettle={(id, answer) => void onSettle(id, answer)}
    />
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6">
      {children}
    </section>
  );
}
