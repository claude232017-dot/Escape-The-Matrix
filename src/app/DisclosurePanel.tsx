import * as Collapsible from '@radix-ui/react-collapsible';
import { DisclosureBody } from '@/features/auth/components/DisclosureBody';
import { DISCLOSURE_VERSION } from '@/features/auth/disclosure';

/**
 * The disclosure, available to re-read at any time.
 *
 * SECURITY.md §3 lists this as a build requirement — *"a member can re-read the disclosure at
 * any time without hunting for it"* — and it was the one row of that table with nothing behind
 * it. He saw the text once, at the moment he was most motivated to click past it, and then it
 * was gone. A consent he cannot re-read is a consent he cannot actually check, which undoes
 * most of what the blocking screen was for.
 *
 * Folded shut by default, because the Circle tab is where he goes to edit his own settings and
 * a wall of legal-shaped text at the top of it would train him to scroll past this exact
 * content. Open, it is the same words the blocking screen shows — literally the same component,
 * so they cannot drift.
 *
 * Lives in `app` rather than in the profile feature because features must not reach sideways
 * into each other, and this is auth's text rendered on profile's tab. Same reason SignedInShell
 * is here.
 */
export function DisclosurePanel({ acceptedAt, acceptedVersion }: {
  acceptedAt: string | null;
  acceptedVersion: string | null;
}) {
  // Formatted as a date in his own reading, not a raw timestamp. `acceptedAt` is an instant, so
  // the browser's locale is the right lens here — unlike a campaign day, which must resolve in
  // profiles.timezone. See src/lib/date.ts for why that distinction is kept explicit.
  const accepted = acceptedAt
    ? new Date(acceptedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <Collapsible.Root className="border-t border-border-subtle pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">What the mentor can see</h2>
        <Collapsible.Trigger className="rounded-[var(--radius-sm)] text-xs text-text-muted underline underline-offset-4 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colour-accent)]">
          Read it again
        </Collapsible.Trigger>
      </div>

      {accepted ? (
        <p className="mt-1 text-xs text-text-muted">
          You accepted this on <span data-numeral>{accepted}</span>
          {acceptedVersion ? (
            <>
              , version <span data-numeral>{acceptedVersion}</span>
            </>
          ) : null}
          .{' '}
          {acceptedVersion === DISCLOSURE_VERSION
            ? 'It has not changed since.'
            : 'It has changed since — you will be asked to read the current version.'}
        </p>
      ) : null}

      <Collapsible.Content
        data-testid="disclosure-reread"
        className="mt-4 flex flex-col gap-5 text-sm leading-relaxed text-text-secondary"
      >
        <DisclosureBody />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
