// TODO: Implement event card with title, venue, blurb, tags, thumbs, source link

interface EventCardProps {
  id: string;
  title: string;
  venue: string;
  blurb: string;
  tags: string[];
  sourceUrl: string;
  thumbsUp: number;
  thumbsDown: number;
}

export function EventCard({ title, venue, blurb, tags, sourceUrl }: EventCardProps) {
  return (
    <div className="border border-white/10 rounded-lg p-4">
      <h3 className="font-[family-name:var(--font-space-grotesk)] font-semibold text-lg">{title}</h3>
      <p className="text-sm text-[var(--color-muted)]">{venue}</p>
      <p className="mt-2 text-sm">{blurb}</p>
      <div className="mt-3 flex gap-2">
        {tags.map((tag) => (
          <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-white/10">
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-link)] text-sm hover:underline"
        >
          Details &rarr;
        </a>
      </div>
    </div>
  );
}
