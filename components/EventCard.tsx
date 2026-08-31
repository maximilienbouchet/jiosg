import { TAG_COLORS } from "../lib/tags";
import { formatDateRange } from "../lib/dates";

interface EventCardProps {
  id: string;
  title: string;
  venue: string;
  blurb: string;
  tags: string[];
  sourceUrl: string;
  eventDateStart?: string;
  eventDateEnd?: string | null;
  entranceDelay?: number;
  onTagClick?: (tag: string) => void;
}

// Editorial row, not a boxed card: the typography carries the design
// (SPEC §7). Hairline separator between rows; on hover the title takes the
// link color, an ↗ fades in, and a 2px rule in the first tag's color marks
// the left edge.
export function EventCard({ title, venue, blurb, tags, sourceUrl, eventDateStart, eventDateEnd, entranceDelay, onTagClick }: EventCardProps) {
  const dateRange = eventDateStart ? formatDateRange(eventDateStart, eventDateEnd ?? null) : null;

  return (
    <div
      className="card-entrance"
      style={{ "--entrance-delay": `${entranceDelay ?? 0}ms` } as React.CSSProperties}
    >
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block cursor-pointer py-5 border-b border-white/[0.06] no-underline text-inherit transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:ring-offset-0 before:absolute before:left-[-16px] before:top-5 before:bottom-5 before:w-[2px] before:rounded-full before:bg-[var(--card-glow)] before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-80"
        style={{ "--card-glow": tags.length > 0 ? TAG_COLORS[tags[0]] : "var(--color-accent)" } as React.CSSProperties}
      >
        <h3 className="font-[family-name:var(--font-space-grotesk)] font-semibold text-xl leading-snug tracking-tight transition-colors duration-300 group-hover:text-[var(--color-link)]">
          {title}
          <span
            aria-hidden="true"
            className="ml-2 inline-block text-sm text-[var(--color-link)] opacity-0 -translate-x-1 transition-all duration-300 group-hover:opacity-80 group-hover:translate-x-0"
          >
            ↗
          </span>
        </h3>
        <p className="mt-1 text-xs font-medium tracking-[0.14em] uppercase text-[var(--color-muted)]">
          {venue}
          {dateRange && <span aria-hidden="true"> · </span>}
          {dateRange}
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-text)]/80">{blurb}</p>
        <div className="mt-3 flex flex-wrap gap-2">
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
