import type { EventRow } from "./db";

export interface ClassifiedEvents {
  newEvents: EventRow[];
  ongoingEvents: EventRow[];
  endingSoonEvents: EventRow[];
}

/**
 * Classify digest events based on whether they appeared in the previous digest.
 *
 * Decision tree per event:
 * 1. Not in previous digest → new
 * 2. In previous digest + multi-day + ending within window → ending_soon
 * 3. In previous digest + multi-day → ongoing
 * 4. In previous digest + single-day → new (single-day events don't repeat across weekly digests)
 */
export function classifyDigestEvents(
  currentEvents: EventRow[],
  previousEventIds: Set<string>,
  windowEnd: string
): ClassifiedEvents {
  const newEvents: EventRow[] = [];
  const ongoingEvents: EventRow[] = [];
  const endingSoonEvents: EventRow[] = [];

  for (const event of currentEvents) {
    const wasInPrevious = previousEventIds.has(event.id);
    const startDate = event.event_date_start.split("T")[0];
    const endDate = event.event_date_end?.split("T")[0] ?? null;
    const isMultiDay = endDate !== null && endDate !== startDate;

    if (!wasInPrevious) {
      newEvents.push(event);
    } else if (isMultiDay && endDate! <= windowEnd) {
      endingSoonEvents.push(event);
    } else if (isMultiDay) {
      ongoingEvents.push(event);
    } else {
      // Single-day event seen before — treat as new
      newEvents.push(event);
    }
  }

  // Sort: new by score desc then date asc
  newEvents.sort((a, b) => {
    const scoreA = a.llm_score ?? 0;
    const scoreB = b.llm_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.event_date_start.localeCompare(b.event_date_start);
  });

  // Sort ongoing/ending_soon by end date asc (ending soonest first)
  ongoingEvents.sort((a, b) =>
    (a.event_date_end ?? "").localeCompare(b.event_date_end ?? "")
  );
  endingSoonEvents.sort((a, b) =>
    (a.event_date_end ?? "").localeCompare(b.event_date_end ?? "")
  );

  // Promotion rule: if fewer than 3 new events, promote highest-scored ongoing
  if (newEvents.length < 3 && ongoingEvents.length > 0) {
    const sorted = [...ongoingEvents].sort((a, b) => {
      const scoreA = a.llm_score ?? 0;
      const scoreB = b.llm_score ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.event_date_start.localeCompare(b.event_date_start);
    });

    const needed = 3 - newEvents.length;
    const promoted = sorted.splice(0, needed);
    newEvents.push(...promoted);

    // Remove promoted events from ongoing
    const promotedIds = new Set(promoted.map((e) => e.id));
    const remaining = ongoingEvents.filter((e) => !promotedIds.has(e.id));
    ongoingEvents.length = 0;
    ongoingEvents.push(...remaining);
  }

  return { newEvents, ongoingEvents, endingSoonEvents };
}
