import { useCallback, useMemo, useState } from 'react';
import {
  emptyDraft,
  evaluateDraft,
  setMedOption,
  setStatus,
  toPayload,
  type ProtocolWithMed,
  type SitrepDraft,
} from '@/features/forge/sitrep-draft';
import type { ProtocolStatus } from '@/features/forge/doctrine';
import { SitrepForm, type FileState } from '@/features/forge/components/SitrepForm';
import { DebriefForm } from '@/features/forge/components/DebriefForm';
import { AttackPatternPanel } from '@/features/forge/components/AttackPatternPanel';
import {
  emptyDebrief,
  toPayload as toDebriefPayload,
  type AttackRecord,
  type DebriefDraft,
  type TriggerKind,
} from '@/features/forge/debrief-draft';

/**
 * The SITREP screen with fixture data and no network.
 *
 * The gate for this feature is a measurement, not an opinion: **filing must take under sixty
 * seconds, one-handed, on a 360px screen.** That cannot be asserted in a unit test, and it cannot
 * be measured against the real screen either, because the real screen needs a signed-in member
 * with a campaign, an enrollment and eleven protocols — none of which a browser test can create
 * without shipping service credentials into the bundle.
 *
 * So the presentational component is driven directly, with the full day-22 protocol catalogue.
 * The fixtures below are the seeded catalogue from app.seed_protocols_for_campaign(), copied
 * deliberately: if a migration changes an activation day or a MED, this harness keeps testing the
 * old shape until someone updates it, and tests/db/forge-rls.test.ts is what pins the real thing.
 *
 * **Excluded from the production bundle.** App.tsx reaches this only behind
 * `import.meta.env.VITE_TEST_HARNESS === '1'`, which Vite inlines as a literal, so the dynamic
 * import is eliminated. tests/browser/sitrep.spec.ts asserts the route is dead in a normal build.
 */

/** Marker string. The bundle test greps the built assets for it to prove the harness was
 *  tree-shaken. Not exported: nothing imports it, and the string only has to be *present* in
 *  this module for its absence from `dist` to mean something. */
const HARNESS_MARKER = 'etm-sitrep-harness-fixture';

function protocol(
  overrides: Partial<ProtocolWithMed> & { slug: string; label: string },
): ProtocolWithMed {
  return {
    id: `id-${overrides.slug}`,
    nickname: null,
    kind: 'duty',
    activatesOnDay: 1,
    isTreasonTrigger: false,
    visibility: 'itemised',
    medOptions: [],
    ...overrides,
  };
}

const FIXTURE_PROTOCOLS: ProtocolWithMed[] = [
  protocol({
    slug: 'morning-protocol',
    label: 'Morning Protocol',
    nickname: 'The 5-Minute Victory',
    medOptions: [
      {
        id: 'med-morning',
        label: 'The 5-Minute Victory',
        body: 'Go to the Command Post, drink one full glass of water, read the Top G Code aloud, perform 20 push-ups.',
      },
    ],
  }),
  protocol({ slug: 'daily-sitrep', label: 'The SITREP' }),
  protocol({
    slug: 'physical-forging',
    label: 'Physical Forging',
    activatesOnDay: 4,
    medOptions: [
      {
        id: 'med-forging-a',
        label: 'Option A',
        body: '100 push-ups and 200 bodyweight squats. May be broken up across the day.',
      },
      { id: 'med-forging-b', label: 'Option B', body: 'A 20-minute non-stop run or brisk walk.' },
    ],
  }),
  protocol({
    slug: 'deep-work',
    label: 'Deep Work',
    nickname: 'The 25-Minute Sprint',
    activatesOnDay: 4,
    medOptions: [
      {
        id: 'med-deep-work',
        label: 'The 25-Minute Sprint',
        body: 'One 25-minute completely uninterrupted Pomodoro on the most important task, under Fortress Protocol rules.',
      },
    ],
  }),
  protocol({
    slug: 'evening-power-down',
    label: 'Evening Power-Down',
    nickname: 'The 15-Minute Shutdown',
    activatesOnDay: 15,
    medOptions: [
      {
        id: 'med-power-down',
        label: 'The 15-Minute Shutdown',
        body: 'Digital Sunset — all screens off — is non-negotiable. At minimum 15 minutes with a physical book before sleep.',
      },
    ],
  }),
  protocol({
    slug: 'sexual-discipline',
    label: 'Sexual discipline',
    kind: 'prohibition',
    isTreasonTrigger: true,
    visibility: 'aggregate_only',
  }),
  protocol({ slug: 'video-games', label: 'Video games', kind: 'prohibition' }),
  protocol({ slug: 'junk-food', label: 'Junk food', kind: 'prohibition', activatesOnDay: 8 }),
  protocol({
    slug: 'alcohol-and-drugs',
    label: 'Alcohol and recreational drugs',
    kind: 'prohibition',
    activatesOnDay: 8,
    visibility: 'aggregate_only',
  }),
  protocol({
    slug: 'binge-watching',
    label: 'Binge-watching',
    kind: 'prohibition',
    activatesOnDay: 15,
  }),
  protocol({
    slug: 'mindless-scrolling',
    label: 'Mindless social media and news',
    kind: 'prohibition',
    activatesOnDay: 22,
  }),
];

const ARTEFACTS = {
  topGCode: 'I do not negotiate with the version of me that wants to quit.',
  commandPostNote: 'Desk by the window. Water, notebook, phone in the drawer.',
  fortressProtocol: 'Phone in another room, notifications off, door shut.',
};

/**
 * A history of attacks, so the pattern panel has something to refuse to over-claim about.
 *
 * `?attacks=` sets how many are present: 0 hides the panel, a number below PATTERN_MINIMUM shows
 * the honest "not enough yet", and the default is enough to name a window.
 */
function fixtureAttacks(count: number): AttackRecord[] {
  const shape: AttackRecord[] = [
    { occurredAtHour: 15, triggerKind: 'low_energy', outcome: 'lost' },
    { occurredAtHour: 15, triggerKind: 'low_energy', outcome: 'lost' },
    { occurredAtHour: 16, triggerKind: 'low_energy', outcome: 'resisted' },
    { occurredAtHour: 14, triggerKind: 'stress', outcome: 'partial' },
    { occurredAtHour: 15, triggerKind: 'boredom', outcome: 'resisted' },
    { occurredAtHour: 9, triggerKind: 'stress', outcome: 'resisted' },
  ];
  return shape.slice(0, Math.min(count, shape.length));
}

function numberFromUrl(name: string, fallback: number): number {
  const raw = new URLSearchParams(window.location.search).get(name);
  const parsed = raw === null ? fallback : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Day 22 by default — every protocol live, which is the worst case for the sixty-second budget.
 * `?day=` overrides it so the activation schedule can be checked from a test.
 */
function dayFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('day');
  const parsed = raw === null ? 22 : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 22;
}

export function SitrepHarness() {
  const day = useMemo(() => dayFromUrl(), []);
  const attacks = useMemo(() => fixtureAttacks(numberFromUrl('attacks', 6)), []);
  const [draft, setDraft] = useState<SitrepDraft>(emptyDraft);
  const [fileState, setFileState] = useState<FileState>('idle');
  const [filed, setFiled] = useState<string | null>(null);

  const [debrief, setDebrief] = useState<DebriefDraft>(emptyDebrief);
  const [triggerKind, setTriggerKind] = useState<TriggerKind | null>(null);
  const [debriefState, setDebriefState] = useState<FileState>('idle');
  const [debriefFiled, setDebriefFiled] = useState<string | null>(null);

  const evaluation = useMemo(
    () => evaluateDraft({ draft, protocols: FIXTURE_PROTOCOLS, day }),
    [draft, day],
  );

  const onStatus = useCallback((target: ProtocolWithMed, status: ProtocolStatus) => {
    setDraft((current) => setStatus(current, target, status));
    setFileState('idle');
  }, []);

  const onMedOption = useCallback((target: ProtocolWithMed, optionId: string) => {
    setDraft((current) => setMedOption(current, target.slug, optionId));
    setFileState('idle');
  }, []);

  const onFile = useCallback(() => {
    const payload = toPayload({
      enrollmentId: 'harness-enrollment',
      localDate: '2026-07-30',
      draft,
      protocols: FIXTURE_PROTOCOLS,
      day,
    });
    // The harness stops at the payload. Sending is what the outbox and the RLS tests cover; what
    // this exists to measure is how long the taps take and whether the payload is right.
    setFiled(payload ? JSON.stringify(payload) : null);
    setFileState(payload ? 'sent' : 'idle');
  }, [draft, day]);

  // Mirrors the clearing rule in SitrepScreen.onDebriefChange, which mirrors the SQL constraint.
  const onDebriefChange = useCallback((patch: Partial<DebriefDraft>) => {
    setDebrief((current) => {
      const next = { ...current, ...patch };
      if (patch.attacked === false) {
        return { ...next, outcome: null, occurredAtHour: null, propaganda: '', attackedProtocolId: null };
      }
      return next;
    });
    if (patch.attacked === false) setTriggerKind(null);
    setDebriefState('idle');
  }, []);

  const onTrigger = useCallback((kind: TriggerKind) => {
    setTriggerKind(kind);
    setDebriefState('idle');
  }, []);

  const onFileDebrief = useCallback(() => {
    const payload = toDebriefPayload('harness-sitrep', debrief, triggerKind);
    setDebriefFiled(payload ? JSON.stringify(payload) : null);
    setDebriefState(payload ? 'sent' : 'idle');
  }, [debrief, triggerKind]);

  return (
    <div className="min-h-dvh bg-surface-void" data-harness={HARNESS_MARKER}>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <SitrepForm
          day={day}
          localDate="2026-07-30"
          campaignLengthDays={30}
          protocols={FIXTURE_PROTOCOLS}
          draft={draft}
          evaluation={evaluation}
          artefacts={ARTEFACTS}
          alreadyFiled={false}
          fileState={fileState}
          queueMessage={
            fileState === 'sent' ? 'Filed. It is on the server.' : 'Nothing waiting to send.'
          }
          refusal={null}
          onStatus={onStatus}
          onMedOption={onMedOption}
          onFile={onFile}
        />
        {/* The payload, so a test can assert what would have been written rather than trusting
            the screen's own summary of it. */}
        <div className="mt-6 flex flex-col gap-6">
          <DebriefForm
            draft={debrief}
            triggerKind={triggerKind}
            protocols={FIXTURE_PROTOCOLS}
            currentHour={15}
            state={debriefState}
            statusMessage={debriefState === 'sent' ? 'Filed. It is on the server.' : 'Not filed yet.'}
            refusal={null}
            alreadyFiled={false}
            onChange={onDebriefChange}
            onTrigger={onTrigger}
            onFile={onFileDebrief}
          />
          <AttackPatternPanel attacks={attacks} />
        </div>
        <pre data-testid="filed-debrief" className="sr-only">
          {debriefFiled ?? ''}
        </pre>
        <pre data-testid="filed-payload" className="sr-only">
          {filed ?? ''}
        </pre>
      </main>
    </div>
  );
}
