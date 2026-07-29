import type { ReactNode } from 'react';

/**
 * The frame every pre-app screen uses.
 *
 * Deliberately has **no navigation**. Sign-in, reset and the disclosure are all states the
 * person cannot route out of, and offering a link would either dead-end or — on the reset
 * screen — be the exact hole §3.7 exists to close.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-void px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-xs font-semibold tracking-[0.2em] text-text-muted uppercase">
          Escape The Matrix
        </p>
        <main
          id="main"
          className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5 sm:p-6"
        >
          <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{subtitle}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </main>
        {footer ? <div className="mt-4 text-xs text-text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Error text with an assertive role, so a failed attempt is announced, not just coloured. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-status-fail">
      {message}
    </p>
  );
}
