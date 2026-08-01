import { useCallback, useState } from 'react';
import {
  PlaybookList,
  PromoteForm,
} from '@/features/playbooks/components/PlaybookList';
import {
  abandonApplication,
  adoptPlaybook,
  answerApplication,
  playbookRefusalMessage,
  promotePlaybook,
} from '@/features/playbooks/playbook-write';
import type { PlaybookData } from '@/features/playbooks/use-playbook-data';

/**
 * Playbooks, wired to the database.
 *
 * Takes its data as a prop, loaded once by the shell — the same rule as every other screen, and
 * asserted by the import-graph test.
 *
 * Nothing here goes through the outbox. Adopting and answering are both single-row writes a man
 * makes while looking at the screen, and neither is on a deadline: unlike a SITREP, there is no
 * midnight that makes a queued playbook answer wrong. The outbox exists for writes that must
 * survive a lost connection at the moment they matter, and this is not one of them.
 */

export interface PlaybookScreenProps {
  data: PlaybookData;
  profileId: string;
  circleId: string;
  isMentor: boolean;
}

export function PlaybookScreen({ data, profileId, circleId, isMentor }: PlaybookScreenProps) {
  const { loaded, error, localDate, reload } = data;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setRefusal(null);
      try {
        await work();
        reload();
      } catch (cause) {
        setRefusal(playbookRefusalMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const onAdopt = useCallback(
    (playbookId: string) =>
      void run(() => adoptPlaybook({ playbookId, profileId, adoptedOn: localDate })),
    [run, profileId, localDate],
  );

  const onAnswer = useCallback(
    (applicationId: string, outcome: 'held' | 'did_not') =>
      void run(() => answerApplication({ applicationId, outcome })),
    [run],
  );

  const onAbandon = useCallback(
    (applicationId: string) => void run(() => abandonApplication(applicationId)),
    [run],
  );

  const onPromote = useCallback(
    (title: string, body: string) =>
      void run(() =>
        promotePlaybook({
          circleId,
          promotedBy: profileId,
          // Null for now: promoting straight from a filed insight needs the Intel screen to
          // hand one over, and the mentor writing the system in his own words is the common
          // case anyway. The column exists and the constraint is live — see 0011.
          promotedFrom: null,
          title,
          body,
        }),
      ),
    [run, circleId, profileId],
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
          Loading the playbooks…
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PlaybookList
        playbooks={loaded.playbooks}
        order={loaded.order}
        mine={loaded.mine}
        transfer={loaded.transfer}
        busy={busy}
        refusal={refusal}
        onAdopt={onAdopt}
        onAnswer={onAnswer}
        onAbandon={onAbandon}
      />

      {isMentor ? <PromoteForm busy={busy} refusal={refusal} onPromote={onPromote} /> : null}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6">
      {children}
    </section>
  );
}
