/**
 * What to say when the app has crashed.
 *
 * Pure and separate from the boundary component so it can be unit tested without a DOM. The
 * boundary itself is twenty lines of React plumbing; the part worth getting right — and worth
 * testing — is deciding what a man is told when the screen he was using has just vanished.
 *
 * The standard is: name what happened, say whether his data is at risk, and give him one thing
 * to do. "Something went wrong" fails all three.
 */

export interface CrashReport {
  /** Shown as the heading. Short, and not an apology. */
  title: string;
  /** One or two sentences. Says whether anything was lost. */
  detail: string;
  /** The technical line, for relaying. Never the only thing shown. */
  technical: string;
  /** True when reloading is likely to help — i.e. the failure looks transient. */
  reloadLikelyHelps: boolean;
}

const UNINFORMATIVE = new Set(['', '{}', '[]', 'null', 'undefined', '[object object]']);

function readable(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || UNINFORMATIVE.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function messageOf(error: unknown): string | null {
  if (typeof error === 'string') return readable(error);
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  return readable(record['message']) ?? readable(record['name']);
}

export function describeCrash(error: unknown): CrashReport {
  const message = messageOf(error);
  const technical = message ?? 'No error message was available.';

  // A failed dynamic import is the one crash with an obvious cause and an obvious fix: the
  // deploy changed under a tab that had been open a while, so the chunk it wants is gone.
  // Reloading genuinely fixes it, which is worth saying rather than making him guess.
  if (message && /dynamically imported module|importing a module script|chunk/i.test(message)) {
    return {
      title: 'The app updated while you had it open',
      detail:
        'A newer version has been deployed, so part of this page no longer exists. Reloading will pick up the new one. Nothing you have filed is affected.',
      technical,
      reloadLikelyHelps: true,
    };
  }

  if (message && /failed to fetch|networkerror|load failed/i.test(message)) {
    return {
      title: 'Lost the connection',
      detail:
        'The app could not reach the server. Check your connection and reload. Nothing you have already filed is affected.',
      technical,
      reloadLikelyHelps: true,
    };
  }

  return {
    title: 'This screen broke',
    detail:
      'Something in the app failed, not something you did. Nothing you have already filed is lost — it is stored on the server, not in this page. Reload to carry on, and send the line below to the mentor if it keeps happening.',
    technical,
    reloadLikelyHelps: true,
  };
}
