"use client";

interface WeekNavProps {
  startDate: Date;
  endDate: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

export function WeekNav({ startDate, endDate, onPrevWeek, onNextWeek }: WeekNavProps) {
  const format = (d: Date) =>
    d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();

  return (
    <div className="flex items-center justify-center gap-6 py-4">
      <button
        onClick={onPrevWeek}
        className="text-[var(--color-accent)] hover:opacity-80 text-xl"
        aria-label="Previous week"
      >
        &larr;
      </button>
      <span
        key={`${startDate.getTime()}`}
        className="font-[family-name:var(--font-space-grotesk)] font-medium tracking-wide week-date-fade"
      >
        {format(startDate)} — {format(endDate)}
      </span>
      <button
        onClick={onNextWeek}
        className="text-[var(--color-accent)] hover:opacity-80 text-xl"
        aria-label="Next week"
      >
        &rarr;
      </button>
    </div>
  );
}
