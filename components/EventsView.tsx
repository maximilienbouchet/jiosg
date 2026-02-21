"use client";

import { useState, useEffect, useCallback } from "react";
import { WeekNav } from "./WeekNav";
import { TagFilter } from "./TagFilter";
import { EventCard } from "./EventCard";
import { EmptyState } from "./EmptyState";

interface EventData {
  id: string;
  title: string;
  venue: string;
  blurb: string;
  tags: string[];
  sourceUrl: string;
  eventDateStart: string;
  thumbsUp: number;
  thumbsDown: number;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d
    .toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })
    .toUpperCase();
}

export function EventsView() {
  const [startDate, setStartDate] = useState(() => {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  });
  const [events, setEvents] = useState<EventData[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const endDate = addDays(startDate, 6);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/events?start=${startDate}&end=${endDate}`)
      .then((res) => res.json())
      .then((data) => {
        setEvents(data.events || []);
        setLoading(false);
      })
      .catch(() => {
        setEvents([]);
        setLoading(false);
      });
  }, [startDate, endDate]);

  const onPrevWeek = useCallback(() => {
    setStartDate((prev) => addDays(prev, -7));
  }, []);

  const onNextWeek = useCallback(() => {
    setStartDate((prev) => addDays(prev, 7));
  }, []);

  const handleVote = useCallback((eventId: string, vote: "up" | "down") => {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, vote }),
    });
  }, []);

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleClearTags = useCallback(() => {
    setSelectedTags([]);
  }, []);

  const filtered =
    selectedTags.length > 0
      ? events.filter((e) => e.tags.some((t) => selectedTags.includes(t)))
      : events;

  // Group by date
  const grouped: Record<string, EventData[]> = {};
  for (const event of filtered) {
    const dateKey = event.eventDateStart.split("T")[0];
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(event);
  }
  const sortedDates = Object.keys(grouped).sort();

  // WeekNav expects Date objects
  const startDateObj = new Date(startDate + "T00:00:00");

  return (
    <div>
      <WeekNav startDate={startDateObj} onPrevWeek={onPrevWeek} onNextWeek={onNextWeek} />
      <TagFilter selectedTags={selectedTags} onToggleTag={handleToggleTag} onClearTags={handleClearTags} />

      {loading ? (
        <p className="text-center py-16 text-[var(--color-muted)]">Loading...</p>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 space-y-8">
          {sortedDates.map((dateKey) => (
            <div key={dateKey}>
              <h2 className="font-[family-name:var(--font-space-grotesk)] font-semibold text-sm tracking-widest text-[var(--color-accent)] mb-4">
                {formatDateHeader(dateKey)}
              </h2>
              <div className="space-y-4">
                {grouped[dateKey].map((event) => (
                  <EventCard
                    key={event.id}
                    id={event.id}
                    title={event.title}
                    venue={event.venue}
                    blurb={event.blurb}
                    tags={event.tags}
                    sourceUrl={event.sourceUrl}
                    thumbsUp={event.thumbsUp}
                    thumbsDown={event.thumbsDown}
                    onVote={handleVote}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
