"use client";

// TODO: Implement tag filter bar with horizontal scroll on mobile

const ALL_TAGS = [
  "live & loud",
  "culture fix",
  "go see",
  "game on",
  "screen time",
  "taste test",
  "touch grass",
  "free lah",
  "last call",
  "bring someone",
  "once only",
  "try lah",
] as const;

interface TagFilterProps {
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

export function TagFilter({ selectedTag, onSelectTag }: TagFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto py-2">
      {ALL_TAGS.map((tag) => (
        <button
          key={tag}
          onClick={() => onSelectTag(selectedTag === tag ? null : tag)}
          className={`whitespace-nowrap text-xs px-3 py-1 rounded-full border transition-colors ${
            selectedTag === tag
              ? "bg-[var(--color-accent)] text-black border-[var(--color-accent)]"
              : "border-white/20 text-[var(--color-muted)] hover:border-white/40"
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
