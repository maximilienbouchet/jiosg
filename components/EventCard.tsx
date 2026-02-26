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

export function EventCard({ title, venue, blurb, tags, sourceUrl, eventDateStart, eventDateEnd, entranceDelay, onTagClick }: EventCardProps) {
  return (
    <div
      className="card-entrance"
      style={{ "--entrance-delay": `${entranceDelay ?? 0}ms` } as React.CSSProperties}
    >
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block cursor-pointer card-shimmer bg-[var(--color-surface-1)] border border-white/[0.07] rounded-lg p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--color-surface-2)] hover:border-white/10 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_0_40px_-10px_var(--card-glow)] no-underline text-inherit"
        style={{ "--card-glow": tags.length > 0 ? TAG_COLORS[tags[0]] : "var(--color-accent)" } as React.CSSProperties}
      >
        <h3 className="font-[family-name:var(--font-space-grotesk)] font-semibold text-lg">
          {title}
        </h3>
        <p className="text-sm text-[var(--color-muted)]">{venue}</p>
        {eventDateStart && formatDateRange(eventDateStart, eventDateEnd ?? null) && (
          <p className="text-sm text-[var(--color-muted)]">
            {formatDateRange(eventDateStart, eventDateEnd ?? null)}
          </p>
        )}
        <p className="mt-2 text-sm">{blurb}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => {
            const color = TAG_COLORS[tag] || "var(--color-muted)";
            return (
              <button
                key={tag}
                type="button"
                className={`text-xs px-2.5 py-1 rounded-full transition-all duration-200 ${onTagClick ? "cursor-pointer hover:brightness-125 hover:scale-105" : ""}`}
                style={{
                  color,
                  backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
                }}
                onClick={(e) => {
                  if (onTagClick) {
                    e.preventDefault();
                    e.stopPropagation();
                    onTagClick(tag);
                  }
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </a>
    </div>
  );
}
