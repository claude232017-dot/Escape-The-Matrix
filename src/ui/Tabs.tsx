import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

/**
 * The app's three views.
 *
 * Not navigation for its own sake. The app had grown to five full-width panels on one page — the
 * SITREP, the debrief, the attack pattern, invitations and the profile — and the Ledger adds two
 * or three more. Stacked, that is a page nobody reaches the bottom of, and every panel competes
 * with the one thing that has a deadline.
 *
 * Three, and only three, with a rule for what belongs in each:
 *
 *  - **Today** — what has to happen before midnight. The SITREP and its debrief. Nothing else
 *    goes here, ever; the moment something without a deadline lands on this tab, the tab stops
 *    meaning anything.
 *  - **Intel** — what the record now says. His attack pattern, and later his week and the
 *    correlations. Read, not write.
 *  - **Circle** — everyone else, plus his own settings.
 *
 * Radix rather than hand-rolled because a tab list has real keyboard semantics — arrow keys
 * between tabs, Home/End, and the panel associated by `aria-controls` — and hand-rolled versions
 * reliably ship with none of them.
 */

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: string; badge?: string | undefined }[];
  children: ReactNode;
}

export function Tabs({ value, onValueChange, tabs, children }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List
        aria-label="Sections"
        className="sticky top-0 z-20 flex border-b border-border-subtle bg-surface-void/95 backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-3xl px-2 sm:px-4">
          {tabs.map((tab) => (
            <RadixTabs.Trigger
              key={tab.value}
              value={tab.value}
              // The active marker is a rule under the label rather than a filled tab, so the bar
              // stays quiet against the content it introduces. Driven by Radix's own
              // `data-state`, which is on the trigger itself — a child span cannot see it.
              className="min-h-11 flex-1 border-b-2 border-transparent px-3 py-3 text-xs font-semibold tracking-[0.14em] text-text-muted uppercase transition-colors hover:text-text-secondary data-[state=active]:border-accent data-[state=active]:text-accent"
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {tab.badge ? (
                  // A count, not a red dot. "3" is actionable; a dot only says "something".
                  <span
                    data-numeral
                    className="rounded-full bg-status-med px-1.5 text-[10px] font-semibold text-accent-ink"
                  >
                    {tab.badge}
                  </span>
                ) : null}
              </span>
            </RadixTabs.Trigger>
          ))}
        </div>
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Content
      value={value}
      // The panel is the scroll container's content; focus lands here when the tab changes, so a
      // keyboard user is not dropped back at the top of the document.
      className="mx-auto w-full max-w-3xl px-4 pt-5 pb-8 outline-none sm:px-6"
    >
      {children}
    </RadixTabs.Content>
  );
}
