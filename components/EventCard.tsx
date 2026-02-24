"use client";

import { useState } from "react";
import { cn } from "../lib/utils";
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
  thumbsUp: number;
  thumbsDown: number;
  onVote: (eventId: string, vote: "up" | "down", previousVote: "up" | "down" | null) => void;
  entranceDelay?: number;
}

function readStoredVote(id: string): "up" | "down" | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(`jio-vote-${id}`);
  return v === "up" || v === "down" ? v : null;
}

export function EventCard({ id, title, venue, blurb, tags, sourceUrl, eventDateStart, eventDateEnd, thumbsUp, thumbsDown, onVote, entranceDelay }: EventCardProps) {
  const [voted, setVoted] = useState<"up" | "down" | null>(() => readStoredVote(id));
  const [localUp, setLocalUp] = useState(() => {
    const stored = readStoredVote(id);
    // If user previously voted up but server count doesn't reflect it yet,
    // we still show the server count as-is (optimistic was already applied on the original click)
    return thumbsUp;
  });
  const [localDown, setLocalDown] = useState(() => thumbsDown);

  const handleVote = (e: React.MouseEvent, direction: "up" | "down") => {
    e.stopPropagation();
    e.preventDefault();

    const prev = voted;

    if (prev === direction) {
      // Undo
      setVoted(null);
      if (direction === "up") setLocalUp((v) => Math.max(v - 1, 0));
      else setLocalDown((v) => Math.max(v - 1, 0));
      localStorage.removeItem(`jio-vote-${id}`);
      onVote(id, direction, prev);
    } else if (prev === null) {
      // New vote
      setVoted(direction);
      if (direction === "up") setLocalUp((v) => v + 1);
      else setLocalDown((v) => v + 1);
      localStorage.setItem(`jio-vote-${id}`, direction);
      onVote(id, direction, null);
    } else {
      // Switch direction
      setVoted(direction);
      if (direction === "up") {
        setLocalUp((v) => v + 1);
        setLocalDown((v) => Math.max(v - 1, 0));
      } else {
        setLocalDown((v) => v + 1);
        setLocalUp((v) => Math.max(v - 1, 0));
      }
      localStorage.setItem(`jio-vote-${id}`, direction);
      onVote(id, direction, prev);
    }
  };

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
              onClick={(e) => handleVote(e, "up")}
              className={cn(
                "text-sm transition-opacity",
                voted === "up" ? "opacity-100" : "opacity-50 hover:opacity-80"
              )}
              aria-label="Thumbs up"
            >
              👍 {localUp > 0 && <span className="text-xs">{localUp}</span>}
            </button>
            <button
              onClick={(e) => handleVote(e, "down")}
              className={cn(
                "text-sm transition-opacity",
                voted === "down" ? "opacity-100" : "opacity-50 hover:opacity-80"
              )}
              aria-label="Thumbs down"
            >
              👎 {localDown > 0 && <span className="text-xs">{localDown}</span>}
            </button>
          </div>
        </div>
      </a>
    </div>
  );
}
