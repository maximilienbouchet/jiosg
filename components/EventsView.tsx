"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { WeekNav } from "./WeekNav";
import { EventCard } from "./EventCard";
import { EmptyState } from "./EmptyState";
import { TAG_COLORS, TAG_DESCRIPTIONS } from "../lib/tags";
import { addDays, getMonday, formatDateHeader } from "../lib/dates";

interface EventData {
  id: string;
  title: string;
  venue: string;
  blurb: string;
  tags: string[];
  sourceUrl: string;
  eventDateStart: string;
  eventDateEnd: string | null;
}

const TAG_PAGE_SIZE = 20;

export function EventsView() {
  const todaySgt = useMemo(() => {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  }, []);

  // Weekly view state
  const [weekOffset, setWeekOffset] = useState(0);
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);

  // Tag view state
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagEvents, setTagEvents] = useState<EventData[]>([]);
  const [tagOffset, setTagOffset] = useState(0);
  const [tagHasMore, setTagHasMore] = useState(false);
  const [tagLoading, setTagLoading] = useState(false);
  const tagLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Portal target for header subtitle
  const [subtitleTarget, setSubtitleTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSubtitleTarget(document.getElementById('header-subtitle'));
  }, []);

  // Read tag from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTag = params.get("tag");
    if (urlTag) {
      setActiveTag(urlTag);
    }
  }, []);

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const tag = e.state?.tag ?? null;
      if (tag) {
        setActiveTag(tag);
        setTagEvents([]);
        setTagOffset(0);
        setTagHasMore(true);
      } else {
        setActiveTag(null);
        setTagEvents([]);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Weekly data fetch
  const { startDate, endDate } = useMemo(() => {
    const monday = getMonday(todaySgt);
    if (weekOffset === 0) {
      return { startDate: todaySgt, endDate: addDays(monday, 6) };
    }
    const s = addDays(monday, weekOffset * 7);
    return { startDate: s, endDate: addDays(s, 6) };
  }, [todaySgt, weekOffset]);

  useEffect(() => {
    setLoading(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // Tag data fetch
  const fetchTagEvents = useCallback(async (tag: string, offset: number, append: boolean) => {
    if (tagLoadingRef.current) return;
    tagLoadingRef.current = true;
    setTagLoading(true);
    try {
      const res = await fetch(`/api/events?tag=${encodeURIComponent(tag)}&limit=${TAG_PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      const newEvents: EventData[] = data.events || [];
      setTagEvents((prev) => append ? [...prev, ...newEvents] : newEvents);
      setTagHasMore(data.hasMore ?? false);
      setTagOffset(offset + newEvents.length);
    } catch {
      if (!append) setTagEvents([]);
      setTagHasMore(false);
    } finally {
      setTagLoading(false);
      tagLoadingRef.current = false;
    }
  }, []);

  // Fetch when activeTag changes
  useEffect(() => {
    if (activeTag) {
      setTagEvents([]);
      setTagOffset(0);
      setTagHasMore(true);
      fetchTagEvents(activeTag, 0, false);
    }
  }, [activeTag, fetchTagEvents]);

  // Infinite scroll observer
  useEffect(() => {
    if (!activeTag) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && tagHasMore && !tagLoadingRef.current && activeTag) {
          fetchTagEvents(activeTag, tagOffset, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTag, tagHasMore, tagOffset, fetchTagEvents]);

  const directionRef = useRef<'next' | 'prev'>('next');

  const onPrevWeek = useCallback(() => {
    directionRef.current = 'prev';
    setWeekOffset((prev) => prev - 1);
  }, []);
  const onNextWeek = useCallback(() => {
    directionRef.current = 'next';
    setWeekOffset((prev) => prev + 1);
  }, []);

  const handleTagClick = useCallback((tag: string) => {
    setActiveTag(tag);
    setTagEvents([]);
    setTagOffset(0);
    setTagHasMore(true);
    window.history.pushState({ tag }, "", `/?tag=${encodeURIComponent(tag)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleTagDismiss = useCallback(() => {
    setActiveTag(null);
    setTagEvents([]);
    window.history.pushState({}, "", "/");
  }, []);

  // Group events by date
  const groupByDate = useCallback((eventList: EventData[], clampStart?: string) => {
    const grouped: Record<string, EventData[]> = {};
    for (const event of eventList) {
      const eventStart = event.eventDateStart.split("T")[0];
      const dateKey = clampStart && eventStart < clampStart ? clampStart : eventStart;
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(event);
    }
    return grouped;
  }, []);

  // --- TAG VIEW ---
  if (activeTag) {
    const tagColor = TAG_COLORS[activeTag] || "var(--color-accent)";
    const grouped = groupByDate(tagEvents);
    const sortedDates = Object.keys(grouped).sort();

    return (
      <div>
        {/* Active tag pill */}
        <div className="py-6 flex items-center gap-3">
          <button
            onClick={handleTagDismiss}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full transition-all duration-200 hover:brightness-125"
            style={{
              color: tagColor,
              backgroundColor: `color-mix(in srgb, ${tagColor} 15%, transparent)`,
              border: `1px solid color-mix(in srgb, ${tagColor} 30%, transparent)`,
            }}
          >
            {activeTag}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-70">
              <path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {TAG_DESCRIPTIONS[activeTag] && (
          <p className="text-xs text-[var(--color-muted)] -mt-4 mb-2 pl-1">
            {TAG_DESCRIPTIONS[activeTag]}
          </p>
        )}

        {tagLoading && tagEvents.length === 0 ? (
          <p className="text-center py-16 text-[var(--color-muted)]">Loading...</p>
        ) : tagEvents.length === 0 && !tagLoading ? (
          <p className="text-center py-16 text-[var(--color-muted)] italic">
            No upcoming events with this tag.
          </p>
        ) : (
          <div className="space-y-8">
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
                      eventDateStart={event.eventDateStart}
                      eventDateEnd={event.eventDateEnd}
                      entranceDelay={0}
                      onTagClick={handleTagClick}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-px" />
        {tagLoading && tagEvents.length > 0 && (
          <p className="text-center py-8 text-[var(--color-muted)]">Loading more...</p>
        )}
      </div>
    );
  }

  // --- WEEKLY VIEW ---
  // Group by date — multi-day events that started before the visible week
  // get grouped under the week's start date (Monday)
  const grouped = groupByDate(events, startDate);
  const sortedDates = Object.keys(grouped).sort();

  // WeekNav expects Date objects
  const startDateObj = new Date(startDate + "T00:00:00");
  const endDateObj = new Date(endDate + "T00:00:00");

  const subtitle = weekOffset === 0 ? 'Curated things to do this week'
    : weekOffset === 1 ? 'Curated things to do next week'
    : weekOffset === -1 ? 'Curated things to do last week'
    : weekOffset > 1 ? `Curated things to do in ${weekOffset} weeks`
    : `Curated things to do ${Math.abs(weekOffset)} weeks ago`;

  const subtitlePortal = subtitleTarget && createPortal(
    <span key={weekOffset} className="text-xs text-[var(--color-muted)] week-date-fade">
      {subtitle}
    </span>,
    subtitleTarget
  );

  return (
    <div>
      {subtitlePortal}
      <WeekNav startDate={startDateObj} endDate={endDateObj} onPrevWeek={onPrevWeek} onNextWeek={onNextWeek} />

      <div
        key={weekOffset}
        className={directionRef.current === 'next' ? 'week-enter-next' : 'week-enter-prev'}
      >
        {loading ? (
          <p className="text-center py-16 text-[var(--color-muted)]">Loading...</p>
        ) : events.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-6 space-y-8">
            {(() => {
              let globalCardIndex = 0;
              return sortedDates.map((dateKey) => (
                <div key={dateKey}>
                  <h2 className="font-[family-name:var(--font-space-grotesk)] font-semibold text-sm tracking-widest text-[var(--color-accent)] mb-4">
                    {formatDateHeader(dateKey)}
                  </h2>
                  <div className="space-y-4">
                    {grouped[dateKey].map((event) => {
                      const delay = globalCardIndex * 80;
                      globalCardIndex++;
                      return (
                        <EventCard
                          key={event.id}
                          id={event.id}
                          title={event.title}
                          venue={event.venue}
                          blurb={event.blurb}
                          tags={event.tags}
                          sourceUrl={event.sourceUrl}
                          eventDateStart={event.eventDateStart}
                          eventDateEnd={event.eventDateEnd}
                          entranceDelay={delay}
                          onTagClick={handleTagClick}
                        />
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
