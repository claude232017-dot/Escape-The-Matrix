/**
 * The campaign, made present.
 *
 * Before this, "Day 22 / 30" was one small line inside the SITREP card — the single most
 * orienting fact in the product, styled like a caption. A man opening this app should know where
 * he is in the campaign before he knows anything else.
 *
 * The progress bar is a fact, not a reward. No colour change at milestones, no fill animation, no
 * celebration at thirty — §1 rules out gamification, and a bar that congratulates is a badge with
 * extra steps. It is here because "day 22" means nothing without "of 30" beside it.
 */
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
  const progress = day === null ? 0 : Math.min(day / lengthDays, 1);

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

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {day === null ? (
            <p className="text-2xl font-semibold text-text-secondary">Not enrolled</p>
          ) : (
            <p className="flex items-baseline gap-1.5">
              <span data-numeral className="text-3xl leading-none font-semibold text-accent">
                {day}
              </span>
              <span data-numeral className="text-sm text-text-muted">
                / {lengthDays}
              </span>
            </p>
          )}

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
            className={`text-xs ${filedToday ? 'text-status-pass' : 'text-status-med'}`}
          >
            {filedToday ? 'Today filed' : 'Today not filed'}
          </p>
        </div>

        {day === null ? null : (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={lengthDays}
            aria-valuenow={day}
            aria-label={`Day ${day} of ${lengthDays}`}
            className="mt-3 h-0.5 w-full bg-border-subtle"
          >
            <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
    </header>
  );
}
