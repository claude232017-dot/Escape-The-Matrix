import type { ReactNode } from 'react';
import { MatrixRain } from '@/app/MatrixRain';

/**
 * The frame every pre-app screen uses.
 *
 * Deliberately has **no navigation**. Sign-in, reset and the disclosure are all states the
 * person cannot route out of, and offering a link would either dead-end or — on the reset
 * screen — be the exact hole §3.7 exists to close.
 *
 * This is also the only place in the app that is allowed to look like anything. It is the
 * threshold: nothing is being decided here, no deadline is running, and a man arriving at six in
 * the morning should feel he is entering somewhere rather than loading a form. Past this door
 * the design gets out of the way and stays out — see MatrixRain for why the rain never follows
 * him to the SITREP.
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
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-surface-void px-4 py-10">
      <MatrixRain />

      {/* A vignette between the rain and the card. Two jobs: it pulls the eye to the centre,
          and it guarantees the panel never sits on a bright glyph — the contrast suite measures
          text against `surface-raised`, and this is what keeps that measurement true when there
          is something moving behind it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 45%, color-mix(in srgb, var(--colour-surface-void) 88%, transparent) 0%, var(--colour-surface-void) 72%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex items-baseline gap-3">
          {/* The one mark in the app. A hairline rule that stops at the wordmark, so the eye
              lands on the name rather than on a logo nobody designed. */}
          <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
          <p className="text-xs font-semibold tracking-[0.28em] text-text-secondary uppercase">
            Escape The Matrix
          </p>
          <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
        </div>

        <main
          id="main"
          // The card is deliberately more solid than anything inside the app: it is sitting on
          // moving glyphs and has to read as a surface rather than a translucent overlay.
          className="rounded-[var(--radius-lg)] border border-border-strong bg-surface-raised p-5 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.9)] sm:p-6"
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
