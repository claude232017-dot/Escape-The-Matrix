import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet';

const VARIANTS: Record<Variant, string> = {
  // accent-ink on accent is a measured pair (11.14:1) — see src/design/tokens.ts.
  primary:
    'bg-accent text-accent-ink hover:bg-accent-strong disabled:bg-border-strong disabled:text-text-muted',
  secondary:
    'border border-border-strong bg-surface-raised text-text-primary hover:border-accent disabled:text-text-muted',
  quiet: 'text-text-secondary hover:text-accent disabled:text-text-muted',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'primary', children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      // type defaults to "submit" in a form, which is a common source of accidental
      // submissions; callers set it explicitly where they mean submit.
      type={rest.type ?? 'button'}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-semibold tracking-wide transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
