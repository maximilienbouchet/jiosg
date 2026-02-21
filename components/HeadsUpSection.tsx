"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatDateHeader } from "../lib/dates";

interface HeadsUpEvent {
  id: string;
  title: string;
  sourceUrl: string;
  eventDateStart: string;
}

function truncateTitle(title: string, max = 45): string {
  return title.length > max ? title.slice(0, max).trimEnd() + "\u2026" : title;
}

export function HeadsUpSection({ visible = true }: { visible?: boolean }) {
  const [events, setEvents] = useState<HeadsUpEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [repeatCount, setRepeatCount] = useState(3);

  useEffect(() => {
    fetch("/api/events/heads-up")
      .then((res) => res.json())
      .then((data) => {
        setEvents(data.events || []);
        setLoaded(true);
      })
      .catch(() => {
        setEvents([]);
        setLoaded(true);
      });
  }, []);

  // Measure content width and compute repetitions for seamless loop
  useEffect(() => {
    if (events.length === 0 || !trackRef.current || !containerRef.current) return;

    const measure = () => {
      const track = trackRef.current;
      const container = containerRef.current;
      if (!track || !container) return;

      // Measure the width of one set of items
      const children = track.children;
      let singleSetWidth = 0;
      for (let i = 0; i < events.length && i < children.length; i++) {
        singleSetWidth += (children[i] as HTMLElement).offsetWidth;
      }

      if (singleSetWidth === 0) return;

      const containerWidth = container.offsetWidth;
      const needed = Math.ceil((containerWidth * 2) / singleSetWidth) + 1;
      setRepeatCount(Math.max(needed, 3));
    };

    // Delay measurement to let fonts/layout settle
    const timer = setTimeout(measure, 100);
    return () => clearTimeout(timer);
  }, [events]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);

  if (!loaded || events.length === 0 || !visible) return null;

  const duration = Math.max(events.length * 10, 15);

  // Build repeated items for seamless loop
  const repeatedItems: { event: HeadsUpEvent; index: number; setIndex: number }[] = [];
  for (let s = 0; s < repeatCount; s++) {
    for (let i = 0; i < events.length; i++) {
      repeatedItems.push({ event: events[i], index: i, setIndex: s });
    }
  }

  return (
    <div
      role="marquee"
      aria-label="Upcoming events worth booking"
      className="my-4 border-y border-white/5 py-3 overflow-hidden"
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-xs font-bold tracking-[0.15em] font-[family-name:var(--font-space-grotesk)] text-[var(--color-accent)]">
          HEADS UP
        </span>
        <div
          ref={containerRef}
          className="overflow-hidden flex-1 relative"
          onClick={togglePause}
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocusCapture={pause}
          onBlurCapture={resume}
        >
          <div
            ref={trackRef}
            className="ticker-scroll flex whitespace-nowrap"
            style={{
              ["--ticker-duration" as string]: `${duration}s`,
              animationPlayState: paused ? "paused" : "running",
            }}
          >
            {repeatedItems.map(({ event, index, setIndex }, i) => (
              <a
                key={`${event.id}-${setIndex}`}
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 text-sm shrink-0 hover:text-[var(--color-accent)] transition-colors"
                aria-hidden={setIndex > 0 ? "true" : undefined}
                tabIndex={setIndex > 0 ? -1 : undefined}
              >
                <span className="text-[var(--color-text)]">
                  {truncateTitle(event.title)}
                </span>
                <span className="text-[var(--color-muted)]">&middot;</span>
                <span className="text-[var(--color-muted)] text-xs">
                  {formatDateHeader(event.eventDateStart)}
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
