/**
 * Local-date arithmetic for a product where a day is a unit of moral accounting.
 *
 * The rule this module exists to enforce: **a calendar date is always resolved in the
 * member's own timezone**, taken from `profiles.timezone` — never from the browser's
 * guess, never from the server's clock, and never from `Date#toISOString()`, which
 * yields the UTC date and would roll a UTC-5 member's day over at 19:00 local.
 *
 * A man who travels does not lose a day. A man reporting at 23:50 files against the
 * day he just lived, not the one starting in Greenwich.
 *
 * Mirror note: the SITREP-per-day uniqueness this feeds is also enforced in SQL by the
 * unique index on (enrollment_id, local_date) — see supabase/migrations. If the shape
 * of an IsoDate changes here, that index and its CHECK constraint change too.
 */

/** A calendar date with no time and no zone: `YYYY-MM-DD`. Never a `Date`. */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Monday. The circle's week runs Monday→Sunday: commitments are declared Monday and settled Sunday. */
export const WEEK_STARTS_ON = 1;

export class InvalidDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDateError';
  }
}

export class InvalidTimeZoneError extends Error {
  constructor(tz: string) {
    super(`Unknown IANA timezone: ${JSON.stringify(tz)}`);
    this.name = 'InvalidTimeZoneError';
  }
}

/** True when `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(tz: string): void {
  if (!isValidTimeZone(tz)) throw new InvalidTimeZoneError(tz);
}

/** True for a well-formed, really-existing calendar date. Rejects `2025-02-30`. */
export function isValidIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

function assertIsoDate(value: string): asserts value is IsoDate {
  if (!isValidIsoDate(value)) {
    throw new InvalidDateError(`Expected YYYY-MM-DD calendar date, got ${JSON.stringify(value)}`);
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock fields as seen in `tz` at the instant `at`. */
function zonedParts(at: Date, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new InvalidTimeZoneError(tz);
    return Number(found.value);
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some ICU builds still emit hour 24 for midnight under h23; normalise it.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The calendar date it is *right now* for someone in `tz`.
 *
 * This is the only sanctioned way to answer "what day is it?". Pass the member's
 * `profiles.timezone`, not `Intl.DateTimeFormat().resolvedOptions().timeZone` — a man
 * whose phone is set to airport time still reports against his home campaign day.
 */
export function getLocalDateString(tz: string, at: Date = new Date()): IsoDate {
  assertTimeZone(tz);
  const { year, month, day } = zonedParts(at, tz);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The wall-clock hour (0–23) in `tz` at `at`. Feeds the debrief's `occurred_at_hour`. */
export function getLocalHour(tz: string, at: Date = new Date()): number {
  assertTimeZone(tz);
  return zonedParts(at, tz).hour;
}

/**
 * Whole days from `a` to `b`, signed.
 *
 * Both ends are parsed as UTC midnight precisely so that a DST transition between them
 * cannot produce a 23- or 25-hour day and therefore a fractional result. Two calendar
 * dates are always a whole number of days apart; that is a property of the calendar,
 * not of the clock, and this function refuses to let clock arithmetic near it.
 */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  assertIsoDate(a);
  assertIsoDate(b);
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / MS_PER_DAY);
}

function toUtcMidnight(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMidnight(ms: number): IsoDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `date` shifted by `n` calendar days. Negative `n` goes backwards. */
export function addDays(date: IsoDate, n: number): IsoDate {
  assertIsoDate(date);
  if (!Number.isInteger(n)) throw new InvalidDateError(`addDays expects whole days, got ${n}`);
  return fromUtcMidnight(toUtcMidnight(date) + n * MS_PER_DAY);
}

/** -1 / 0 / 1, so dates sort without being turned into `Date`s. */
export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  assertIsoDate(a);
  assertIsoDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Day of week, 0=Sunday … 6=Saturday, computed from the calendar not the clock. */
export function dayOfWeek(date: IsoDate): number {
  assertIsoDate(date);
  return new Date(toUtcMidnight(date)).getUTCDay();
}

/**
 * The Monday of the week containing `date` — the `week_start` key for commitments and
 * weekly reviews. Because it derives from an already-zone-resolved IsoDate, each
 * member's week boundary lands at his own local midnight.
 */
export function startOfWeek(date: IsoDate, weekStartsOn: number = WEEK_STARTS_ON): IsoDate {
  const shift = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -shift);
}

/** The Sunday closing the week containing `date`. */
export function endOfWeek(date: IsoDate, weekStartsOn: number = WEEK_STARTS_ON): IsoDate {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

/**
 * The UTC instant at which `date` begins in `tz`.
 *
 * Resolved in two passes: guess the offset, correct it, and re-check. A single pass is
 * wrong across a DST boundary, where the offset in force at the guessed instant is not
 * the offset in force at the true one.
 *
 * On a spring-forward day the local midnight may not exist in zones that transition at
 * midnight; the result is then the first instant that does exist that day, which is the
 * behaviour a deadline wants.
 */
export function startOfLocalDay(date: IsoDate, tz: string): Date {
  assertIsoDate(date);
  assertTimeZone(tz);
  const target = toUtcMidnight(date);
  let guess = target - offsetMsAt(new Date(target), tz);
  const corrected = target - offsetMsAt(new Date(guess), tz);
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}

/**
 * The instant a member's day is over in `tz` — i.e. his SITREP deadline. Exclusive: it
 * is the first instant of the following day.
 */
export function endOfLocalDay(date: IsoDate, tz: string): Date {
  return startOfLocalDay(addDays(date, 1), tz);
}

/** `tz`'s offset from UTC in milliseconds at the instant `at` (east of UTC is positive). */
export function offsetMsAt(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Floor to the second: offsets are whole minutes, and `at` carries milliseconds that
  // formatToParts truncated away. Math.floor rather than `% 1000` so instants before
  // the epoch (negative time values) truncate in the same direction.
  const flooredToSecond = Math.floor(at.getTime() / 1000) * 1000;
  return asIfUtc - flooredToSecond;
}

/**
 * Campaign day number, 1-based: the enrollment's `started_on` is **Day 1**, not Day 0.
 *
 * Derived, never stored. A reset creates a new enrollment row with a new `started_on`
 * and the count falls out of that — there is no counter to decrement and no history to
 * destroy. See docs/DOCTRINE.md §Failure states and ADR-002.
 */
export function campaignDay(startedOn: IsoDate, today: IsoDate): number {
  const elapsed = daysBetween(startedOn, today);
  if (elapsed < 0) {
    throw new InvalidDateError(
      `Campaign day requested for ${today}, which precedes the enrollment start ${startedOn}`,
    );
  }
  return elapsed + 1;
}

/**
 * Whether a protocol introduced on `activatesOnDay` is live on campaign day `day`.
 * A protocol that is not yet active cannot be failed, and must not be offered.
 */
export function isProtocolActive(activatesOnDay: number, day: number): boolean {
  return day >= activatesOnDay;
}

/** Inclusive list of dates from `from` to `to`. Throws if the range is inverted. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const span = daysBetween(from, to);
  if (span < 0) throw new InvalidDateError(`Inverted range: ${from} → ${to}`);
  return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
}
