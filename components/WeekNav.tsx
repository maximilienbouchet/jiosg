"use client";

interface WeekNavProps {
  startDate: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

export function WeekNav({ startDate, onPrevWeek, onNextWeek }: WeekNavProps) {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);

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
      <span className="font-[family-name:var(--font-space-grotesk)] font-medium tracking-wide">
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
