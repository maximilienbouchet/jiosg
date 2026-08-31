import { TAG_COLORS } from "../lib/tags";
import { formatDateRange, formatDateHeader } from "../lib/dates";

interface HeroPickProps {
  title: string;
  venue: string;
  blurb: string;
  tags: string[];
  sourceUrl: string;
  eventDateStart: string;
  eventDateEnd: string | null;
  onTagClick?: (tag: string) => void;
}

/**
 * The week's rank-1 editorial pick, rendered once above the day groups.
 * Oversized type inside a border-glow frame — the one place the page
 * announces its own curation.
 */
export function HeroPick({ title, venue, blurb, tags, sourceUrl, eventDateStart, eventDateEnd, onTagClick }: HeroPickProps) {
  const dateRange = formatDateRange(eventDateStart, eventDateEnd);
  const dateLabel = dateRange ?? formatDateHeader(eventDateStart.slice(0, 10));

  return (
    <div className="card-entrance mt-6" style={{ "--entrance-delay": "0ms" } as React.CSSProperties}>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block cursor-pointer rounded-xl p-6 sm:p-7 no-underline text-inherit border border-white/[0.08] bg-[var(--color-surface-1)]/60 transition-all duration-300 hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-surface-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60"
      >
        <p className="text-[10px] font-semibold tracking-[0.3em] text-[var(--color-accent)] uppercase">
          Pick of the week
        </p>
        <h2 className="mt-3 font-[family-name:var(--font-space-grotesk)] font-bold text-3xl sm:text-4xl leading-[1.1] tracking-tight transition-colors duration-300 group-hover:text-[var(--color-link)]">
          {title}
          <span
            aria-hidden="true"
            className="ml-3 inline-block text-xl text-[var(--color-link)] opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-80 group-hover:translate-x-0"
          >
            ↗
          </span>
        </h2>
        <p className="mt-3 text-xs font-medium tracking-[0.14em] uppercase text-[var(--color-muted)]">
          {dateLabel}
          <span aria-hidden="true"> · </span>
          {venue}
        </p>
        <p className="mt-3 text-base leading-relaxed text-[var(--color-text)]/85">{blurb}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => {
            const color = TAG_COLORS[tag] || "var(--color-muted)";
            return (
              <button
                key={tag}
                type="button"
                className={`inline-flex items-center gap-1.5 text-[11px] lowercase tracking-wide px-2 py-0.5 rounded-full transition-all duration-200 ${onTagClick ? "cursor-pointer hover:brightness-125" : ""}`}
                style={{
                  color,
                  backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                }}
                onClick={(e) => {
                  if (onTagClick) {
                    // Same contract as EventCard: chips filter, never navigate.
                    e.preventDefault();
                    e.stopPropagation();
                    onTagClick(tag);
                  }
                }}
              >
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {tag}
              </button>
            );
          })}
        </div>
      </a>
    </div>
  );
}
