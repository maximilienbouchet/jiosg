"use client";

import { ALL_TAGS, TAG_COLORS } from "../lib/tags";

interface TagFilterProps {
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
}

export function TagFilter({ selectedTags, onToggleTag, onClearTags }: TagFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2">
      {selectedTags.length > 0 && (
        <button
          onClick={onClearTags}
          className="whitespace-nowrap text-xs px-3 py-1 rounded-full border border-white/20 text-[var(--color-text)] hover:border-white/40 transition-colors"
        >
          all
        </button>
      )}
      {ALL_TAGS.map((tag) => {
        const isSelected = selectedTags.includes(tag);
        const color = TAG_COLORS[tag] || "var(--color-muted)";

        return (
          <button
            key={tag}
            onClick={() => onToggleTag(tag)}
            className="whitespace-nowrap text-xs px-3 py-1 rounded-full border transition-colors"
            style={
              isSelected
                ? {
                    backgroundColor: color,
                    color: "#0A0A0F",
                    borderColor: color,
                  }
                : {
                    backgroundColor: "transparent",
                    color: `color-mix(in srgb, ${color} 70%, var(--color-text))`,
                    borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
                  }
            }
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}
