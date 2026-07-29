import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Shown below the input. Announced to screen readers via aria-describedby. */
  hint?: ReactNode;
  /** When set, the input is marked invalid and this replaces the hint. */
  error?: string | null;
}

/**
 * A labelled input.
 *
 * The label is always a real `<label for>` — never a placeholder. A placeholder-as-label
 * disappears the moment someone types, which is precisely when they most need to know what
 * the field was.
 */
export function Field({ label, hint, error, className = '', ...rest }: FieldProps) {
  const id = useId();
  const describedById = `${id}-description`;
  const description = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={description ? describedById : undefined}
        className={`min-h-11 rounded-[var(--radius-md)] border bg-surface-base px-3 text-base text-text-primary placeholder:text-text-muted ${
          error ? 'border-status-fail' : 'border-border-strong'
        } ${className}`}
        {...rest}
      />
      {description ? (
        <p
          id={describedById}
          // role="alert" only for errors: announcing a static hint interrupts for no reason.
          {...(error ? { role: 'alert' as const } : {})}
          className={`text-xs ${error ? 'text-status-fail' : 'text-text-muted'}`}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
