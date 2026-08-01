/**
 * The campaign, made present.
 *
 * Before this, "Day 22 / 30" was one small line inside the SITREP card — the single most
 * orienting fact in the product, styled like a caption. A man opening this app should know where
 * he is in the campaign before he knows anything else.
 *
 * ---------------------------------------------------------------------------
 * The rule the styling has to obey
 * ---------------------------------------------------------------------------
 * §1 rules out gamification, and a header is exactly where gamification creeps in: a milestone
 * colour at day 15, a bar that fills with a flourish, a streak that grows a flame. Nothing here
 * responds to how well he is doing. **Every mark in this component is a function of the calendar,
 * not of his performance** — the day count, the elapsed segments and the "you are here" marker
 * all read identically on his best day and his worst. The only performance figures present are
 * the streak and whether today is filed, and both are stated as counts and facts rather than
 * rewarded.
 *
 * ---------------------------------------------------------------------------
 * Why the progress rule is segmented
 * ---------------------------------------------------------------------------
 * A smooth bar at 73% is a percentage nobody asked for. A thirty-day campaign has thirty days in
 * it, and a man can count the eight that are left — which is the question he is actually asking.
 * The segment for today is drawn full height, so the rule answers "where am I" without being
 * read as a score.
 *
 * Above `SEGMENT_LIMIT` days the segments would be thinner than a hairline on a 320px phone and
 * stop being countable, which is the entire justification for drawing them. Past that it falls
 * back to a continuous bar.
 */

/** Beyond this many days the segments are too thin to count, so the continuous bar is honest. */
const SEGMENT_LIMIT = 60;

export interface CampaignHeaderProps {
  /** Null before he has enrolled: there is no campaign day to be on. */
  day: number | null;
  lengthDays: number;
  campaignName: string;
  memberName: string;
  isMentor: boolean;
  /** Consecutive complete days ending today. */
  streak: number;
  /** True once today's SITREP is on the server. */
  filedToday: boolean;
}

export function CampaignHeader({
  day,
  lengthDays,
  campaignName,
  memberName,
  isMentor,
  streak,
  filedToday,
}: CampaignHeaderProps) {
  // A zero or negative length would divide by zero and render thirty ticks of NaN. It comes from
  // the campaigns table rather than from this file, so it is guarded rather than assumed.
  const total = Math.max(lengthDays, 1);
  // Past the final day the campaign is over, not 110% complete.
  const elapsed = day === null ? 0 : Math.min(Math.max(day, 0), total);
  const progress = elapsed / total;
  const segmented = total <= SEGMENT_LIMIT;

  return (
    <header data-testid="campaign-header" className="border-b border-border-subtle bg-surface-base">
      <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-text-muted uppercase">
            {campaignName}
          </p>
          <p className="text-xs text-text-muted">
            {memberName}
            {isMentor ? ' · mentor' : ''}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
          {day === null ? (
            <p className="text-2xl font-semibold text-text-secondary">Not enrolled</p>
          ) : (
            <div>
              {/* The label carries the unit so the numeral does not have to. It is set small and
                  wide precisely so the eye skips it and lands on the figure. */}
              <p
                aria-hidden="true"
                className="text-[10px] leading-none font-semibold tracking-[0.32em] text-text-muted uppercase"
              >
                Day
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                {/* The one large numeral in the entire application. Everything else is set at
                    caption or body size, which is what lets this carry the screen without any
                    colour or weight it has not earned. */}
                <span
                  data-numeral
                  data-testid="campaign-day"
                  className="text-[2.75rem] leading-[0.85] font-semibold text-accent sm:text-5xl"
                >
                  {day}
                </span>
                <span data-numeral className="text-sm text-text-muted">
                  / {lengthDays}
                </span>
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-0.5">
            {streak > 0 ? (
              <p className="text-xs text-text-secondary">
                {/* A count, not a trophy. It is the one number that makes a MED pass feel like the
                    win it is, because a MED pass keeps it. */}
                <span data-numeral className="font-semibold text-text-primary">
                  {streak}
                </span>{' '}
                {streak === 1 ? 'day held in a row' : 'days held in a row'}
              </p>
            ) : null}

            <p
              data-testid="filed-today"
              className={`inline-flex items-center gap-1.5 text-xs ${
                filedToday ? 'text-status-pass' : 'text-status-med'
              }`}
            >
              {/* Redundant with the words and with the colour, never instead of them: a pip alone
                  would put the state in colour only, which is unreadable to a third of men with
                  a colour deficiency and to anyone in bright sun. */}
              <span
                aria-hidden="true"
                className={`inline-block size-1.5 rounded-full ${
                  filedToday ? 'bg-status-pass' : 'bg-status-med'
                }`}
              />
              {filedToday ? 'Today filed' : 'Today not filed'}
            </p>
          </div>
        </div>

        {day === null ? null : (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            // `elapsed`, not `day`. Past the final day the two diverge, and a `valuenow` above
            // `valuemax` is invalid ARIA — screen readers are free to announce anything from
            // "113%" to nothing at all. The *label* still carries the true day, so nothing is
            // hidden; only the ratio is clamped to a range it is allowed to sit in.
            aria-valuenow={elapsed}
            // The visible numeral says "22 / 30" already; this is what a screen reader is told,
            // and it has to stand alone because the numeral is not part of this element.
            aria-label={`Day ${String(day)} of ${String(lengthDays)}`}
            data-testid="campaign-progress"
            className="mt-3 flex h-3 w-full items-end gap-px"
          >
            {segmented ? (
              // A progressbar's children are presentational to assistive technology, so these
              // carry no labels and need none — the value above is the whole announcement.
              Array.from({ length: total }, (_, index) => {
                const dayNumber = index + 1;
                const isToday = dayNumber === elapsed;
                const isPast = dayNumber < elapsed;
                return (
                  <span
                    key={dayNumber}
                    data-testid={isToday ? 'campaign-segment-today' : undefined}
                    data-day={dayNumber}
                    // `min-w-0` is precautionary rather than load-bearing: these spans are
                    // empty, so their content size is already zero and flex shrinks them to
                    // share a 288px phone without it. Deleting it does not currently cause
                    // overflow — verified by mutation, so the comment does not claim otherwise.
                    // It is here for the day somebody puts a character inside a segment.
                    className={`min-w-0 flex-1 rounded-[1px] ${
                      isToday
                        ? 'h-3 bg-accent'
                        : isPast
                          ? 'h-1 bg-accent opacity-55'
                          : 'h-1 bg-border-subtle'
                    }`}
                  />
                );
              })
            ) : (
              <span className="h-1 w-full bg-border-subtle">
                <span
                  className="block h-full bg-accent"
                  style={{ width: `${String(progress * 100)}%` }}
                />
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
