import { isValidTimeZone } from '@/lib/date';

/**
 * Timezone choices.
 *
 * In `lib` because both features need it: `auth` at signup, `profile` whenever a man moves or
 * discovers the guess was wrong. A feature importing another feature is the knot the
 * import-graph test rejects.
 *
 * Captured at signup, deliberately, because `profiles.timezone` decides every day count,
 * week boundary and SITREP deadline this man will ever have. Defaulting it silently to UTC
 * and hoping he finds the setting later means his first days are counted against the wrong
 * clock, and nobody notices until a report lands on the wrong date.
 */

/**
 * A short list, used only when the runtime cannot enumerate zones itself.
 *
 * Not meant to be complete — it is a fallback, and a man in a zone that is missing needs the
 * full list rather than a nearby guess, since "nearby" can still be a different date.
 */
const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'America/St_Johns',
  'America/Halifax',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Mexico_City',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Anchorage',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Argentina/Buenos_Aires',
  'Africa/Casablanca',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Africa/Cairo',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

/** Every IANA zone this runtime knows, or the fallback list on an older one. */
export function timezoneOptions(): string[] {
  try {
    // ES2022. Gives the complete list, so nobody has to settle for "close enough".
    const supported = Intl.supportedValuesOf('timeZone');
    if (supported.length > 0) {
      // `supportedValuesOf` returns canonical IANA names, and the canonical spelling of UTC
      // is `Etc/UTC` — so plain "UTC" is absent from a list of 400-odd zones. It is the one
      // name people actually look for, and `profiles.timezone` accepts it, so it goes first.
      return supported.includes('UTC') ? [...supported] : ['UTC', ...supported];
    }
  } catch {
    // Older runtime: fall through.
  }
  return [...FALLBACK_ZONES];
}

/**
 * The browser's best guess, used to preselect — never to decide silently.
 *
 * Presented as a default the man confirms. A guess is right most of the time and wrong in
 * exactly the case that matters: someone setting up on a laptop that is still on holiday
 * time, or a phone that picked up the airport.
 */
export function guessTimezone(): string {
  try {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (guess && isValidTimeZone(guess)) return guess;
  } catch {
    // Fall through to UTC.
  }
  return 'UTC';
}

/** The current UTC offset of `tz`, as `+05:30`, so the choice can be checked at a glance. */
export function offsetLabel(tz: string, at: Date = new Date()): string {
  if (!isValidTimeZone(tz)) return '';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).format(at);
  // "1/1/2026, GMT+05:30" → "+05:30". GMT alone (no offset) means exactly zero.
  const match = /GMT([+-]\d{2}:\d{2})/.exec(formatted);
  return match?.[1] ?? '+00:00';
}

/** `Europe/London (+01:00)` — the label people can actually verify against a clock. */
export function timezoneLabel(tz: string, at: Date = new Date()): string {
  const offset = offsetLabel(tz, at);
  return offset ? `${tz} (${offset})` : tz;
}
