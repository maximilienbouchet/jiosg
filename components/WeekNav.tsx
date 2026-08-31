"use client";

interface WeekNavProps {
  startDate: Date;
  endDate: Date;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onBackToThisWeek: () => void;
}

export function WeekNav({ startDate, endDate, isCurrentWeek, onPrevWeek, onNextWeek, onBackToThisWeek }: WeekNavProps) {
  const format = (d: Date) =>
    d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();

  return (
    <div className="py-3">
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={onPrevWeek}
          className="text-[var(--color-accent)] hover:opacity-80 text-xl px-3 py-2 -my-2 rounded-lg transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60"
          aria-label="Previous week"
        >
          &larr;
        </button>
        <span
          key={`${startDate.getTime()}`}
          className="min-w-[15rem] text-center font-[family-name:var(--font-space-grotesk)] font-medium tracking-wide week-date-fade"
        >
          {isCurrentWeek ? (
            <>
              <span className="text-[var(--color-accent)] text-xs font-semibold tracking-[0.25em] align-middle">
                THIS WEEK
              </span>
              <span className="block text-xs text-[var(--color-muted)] tracking-wide mt-0.5">
                {format(startDate)} — {format(endDate)}
              </span>
            </>
          ) : (
            <>
              {format(startDate)} — {format(endDate)}
            </>
          )}
        </span>
        <button
          onClick={onNextWeek}
          className="text-[var(--color-accent)] hover:opacity-80 text-xl px-3 py-2 -my-2 rounded-lg transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60"
          aria-label="Next week"
        >
          &rarr;
        </button>
      </div>
      {!isCurrentWeek && (
        <div className="text-center mt-1">
          <button
            onClick={onBackToThisWeek}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-link)] transition-colors underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 rounded"
          >
            &larr; back to this week
          </button>
        </div>
      )}
    </div>
  );
}
