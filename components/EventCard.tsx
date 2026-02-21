"use client";

import { useState } from "react";
import { cn } from "../lib/utils";
import { TAG_COLORS } from "../lib/tags";

interface EventCardProps {
  id: string;
  title: string;
  venue: string;
  blurb: string;
  tags: string[];
  sourceUrl: string;
  thumbsUp: number;
  thumbsDown: number;
  onVote: (eventId: string, vote: "up" | "down") => void;
}

export function EventCard({ id, title, venue, blurb, tags, sourceUrl, thumbsUp, thumbsDown, onVote }: EventCardProps) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);
  const [localUp, setLocalUp] = useState(thumbsUp);
  const [localDown, setLocalDown] = useState(thumbsDown);

  const handleVote = (direction: "up" | "down") => {
    if (voted) return;
    setVoted(direction);
    if (direction === "up") setLocalUp((v) => v + 1);
    else setLocalDown((v) => v + 1);
    onVote(id, direction);
  };

  return (
    <div className="border border-white/10 rounded-lg p-4 transition-transform hover:-translate-y-0.5">
      <h3 className="font-[family-name:var(--font-space-grotesk)] font-semibold text-lg">
        {title}
      </h3>
      <p className="text-sm text-[var(--color-muted)]">{venue}</p>
      <p className="mt-2 text-sm">{blurb}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((tag) => {
          const color = TAG_COLORS[tag] || "var(--color-muted)";
          return (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                color,
                backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
              }}
            >
              {tag}
            </span>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleVote("up")}
            disabled={voted !== null}
            className={cn(
              "text-sm transition-opacity",
              voted === "up" ? "opacity-100" : "opacity-50 hover:opacity-80",
              voted === "down" && "opacity-30"
            )}
            aria-label="Thumbs up"
          >
            👍 {localUp > 0 && <span className="text-xs">{localUp}</span>}
          </button>
          <button
            onClick={() => handleVote("down")}
            disabled={voted !== null}
            className={cn(
              "text-sm transition-opacity",
              voted === "down" ? "opacity-100" : "opacity-50 hover:opacity-80",
              voted === "up" && "opacity-30"
            )}
            aria-label="Thumbs down"
          >
            👎 {localDown > 0 && <span className="text-xs">{localDown}</span>}
          </button>
        </div>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-link)] text-sm hover:underline"
        >
          &rarr;
        </a>
      </div>
    </div>
  );
}
