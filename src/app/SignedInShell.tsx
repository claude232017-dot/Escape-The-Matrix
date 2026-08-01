import { useState } from 'react';
import { PHASE, PHASE_LABEL } from '@/app/build-info';
import { CampaignHeader } from '@/app/CampaignHeader';
import { DisclosurePanel } from '@/app/DisclosurePanel';
import { useAuth } from '@/features/auth/auth-context';
import { InvitePanel } from '@/features/circle/components/InvitePanel';
import { ProfileScreen } from '@/features/profile/components/ProfileScreen';
import { ForgeScreen, type ForgeView } from '@/features/forge/components/ForgeScreen';
import { useForgeData } from '@/features/forge/use-forge-data';
import { LedgerScreen } from '@/features/ledger/components/LedgerScreen';
import { WeekScreen } from '@/features/week/components/WeekScreen';
import { CommanderScreen } from '@/features/command/components/CommanderScreen';
import { useLedgerData } from '@/features/ledger/use-ledger-data';
import { useWeekData } from '@/features/week/use-week-data';
import { useCommandData } from '@/features/command/use-command-data';
import { Button } from '@/ui/Button';
import { TabPanel, Tabs } from '@/ui/Tabs';

/**
 * What a signed-in member sees.
 *
 * Lives in `app` rather than in a feature because it is the wiring: it reads the session from the
 * auth feature and passes plain values down to the forge, circle and profile features, so none of
 * them import each other.
 *
 * Five tabs, with the rule for what belongs in each stated in @/ui/Tabs. The one worth repeating
 * here: **nothing without a deadline goes on Today.** The build-status panel that used to sit
 * between the SITREP and the invitations is developer scaffolding and has moved to a footer line,
 * because a card telling a man which phase the software is in was competing with the card telling
 * him whether he had held his oath.
 */
export function SignedInShell() {
  const { profile, signOut, refreshProfile, busy } = useAuth();
  const [tab, setTab] = useState('today');
  const [forge, setForge] = useState<ForgeView | null>(null);

  // Loaded once, here, and handed to both tabs. Radix unmounts an inactive panel, so a screen
  // that loaded its own data re-ran the whole query chain on every switch between Today and
  // Intel — nine round trips per tap. The data belongs to the session, not to a panel.
  const data = useForgeData(profile?.id ?? '', profile?.timezone ?? 'UTC');
  const ledger = useLedgerData(profile?.id ?? '', profile?.timezone ?? 'UTC');
  const week = useWeekData(profile?.id ?? '', profile?.timezone ?? 'UTC');
  const command = useCommandData(profile?.id ?? '', profile?.timezone ?? 'UTC');

  if (!profile) return null; // Unreachable: AuthGate only renders this in the 'app' view.

  const needsSetup = profile.topGCode === null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="min-h-dvh bg-surface-void text-text-primary">
        <CampaignHeader
          day={forge?.day ?? null}
          lengthDays={forge?.lengthDays ?? 30}
          campaignName={forge?.campaignName ?? 'Escape The Matrix'}
          memberName={profile.displayName}
          isMentor={profile.role === 'mentor'}
          streak={forge?.streak ?? 0}
          filedToday={forge?.filedToday ?? false}
        />

        <main id="main">
          <Tabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              {
                value: 'today',
                label: 'Today',
                // The count is what has to happen before midnight, so it is the one badge in the
                // app. It disappears the moment the day is filed rather than turning into a tick.
                badge: forge?.outstanding ? String(forge.outstanding) : undefined,
              },
              { value: 'ledger', label: 'Ledger' },
              { value: 'week', label: 'Week' },
              { value: 'intel', label: 'Intel' },
              { value: 'command', label: 'Command' },
              { value: 'circle', label: 'Circle' },
            ]}
          >
            <TabPanel value="today">
              {/* Prompted rather than nagged, and only where it bites: the Morning Protocol
                  cannot show him a Code he has not written. */}
              {needsSetup ? (
                <section className="mb-5 rounded-[var(--radius-md)] border-l-2 border-status-med bg-surface-raised px-4 py-3">
                  <h2 className="text-sm font-semibold text-text-primary">
                    Write your Top G Code
                  </h2>
                  <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-secondary">
                    The Morning Protocol reads it back to you at the moment it asks you to say it
                    aloud. Without it, that protocol has nothing to show.
                  </p>
                  <Button className="mt-3" onClick={() => setTab('circle')}>
                    Write it now
                  </Button>
                </section>
              ) : null}

              <ForgeScreen
                view="today"
                data={data}
                profileId={profile.id}
                timezone={profile.timezone}
                artefacts={{
                  topGCode: profile.topGCode,
                  commandPostNote: profile.commandPostNote,
                  fortressProtocol: profile.fortressProtocol,
                }}
                onState={setForge}
              />
            </TabPanel>

            <TabPanel value="ledger">
              <LedgerScreen data={ledger} profileId={profile.id} />
            </TabPanel>

            <TabPanel value="week">
              <WeekScreen data={week} profileId={profile.id} />
            </TabPanel>

            <TabPanel value="intel">
              <ForgeScreen
                view="intel"
                data={data}
                profileId={profile.id}
                timezone={profile.timezone}
                artefacts={{
                  topGCode: profile.topGCode,
                  commandPostNote: profile.commandPostNote,
                  fortressProtocol: profile.fortressProtocol,
                }}
              />
            </TabPanel>

            <TabPanel value="command">
              {/* Every member sees this. What differs is what the *database* returns him:
                  member_days is security_invoker, so a peer's rows arrive with the money
                  already blanked. The tab is not a permission. */}
              <CommanderScreen
                data={command}
                isMentor={profile.role === 'mentor'}
                profileId={profile.id}
              />
            </TabPanel>

            <TabPanel value="circle">
              <div className="flex flex-col gap-6">
                <ProfileScreen
                  profileId={profile.id}
                  initial={{
                    displayName: profile.displayName,
                    timezone: profile.timezone,
                    topGCode: profile.topGCode,
                    commandPostNote: profile.commandPostNote,
                    fortressProtocol: profile.fortressProtocol,
                  }}
                  onSaved={refreshProfile}
                />

                {/* isMentor is presentation only. What stops a member creating invitations is the
                    RLS policy requiring app.is_mentor(). */}
                <InvitePanel circleId={profile.circleId} isMentor={profile.role === 'mentor'} />

                {/* SECURITY.md §3: he can re-read what he agreed to, without asking anyone. */}
                <DisclosurePanel
                  acceptedAt={profile.disclosureAcceptedAt}
                  acceptedVersion={profile.disclosureVersion}
                />

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-5">
                  <p className="text-xs text-text-muted">
                    Phase <span data-numeral>{PHASE}</span> — {PHASE_LABEL}. Built for a closed
                    circle. Not a product, not a funnel.
                  </p>
                  <Button variant="secondary" onClick={() => void signOut()} disabled={busy}>
                    Sign out
                  </Button>
                </div>
              </div>
            </TabPanel>
          </Tabs>
        </main>
      </div>
    </>
  );
}
