import type { EventRow } from "./db";

// The spec promises ~10 curated events per rolling 7-day window — never pad,
// never flood. Publishing (score >= 7) decides what is ELIGIBLE; this layer
// decides what is SHOWN, so a well-scraped week doesn't turn into a 35-event
// scroll and a quiet week still shows only what's genuinely worth the time.
// Selection is display-time only: everything stays in the DB and admin panel.
const MAX_WINDOW_EVENTS = 12;
// One venue's programme (e.g. a rep cinema's weekly slate) must not dominate.
const MAX_PER_SOURCE = 4;
// Long-running exhibitions overlap every window; without a limit they would
// permanently occupy slots that belong to the week's fresh events.
const MAX_ONGOING = 4;

export function selectWindowEvents(rows: EventRow[], windowStart: string): EventRow[] {
  if (rows.length <= MAX_WINDOW_EVENTS) return rows;

  // Manual adds carry no llm_score; an admin published them deliberately, so
  // rank them as solid (7) rather than sinking them below every scored event.
  const scoreOf = (e: EventRow) => e.llm_score ?? 7;

  const ranked = [...rows].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) ||
      b.is_heads_up - a.is_heads_up ||
      a.event_date_start.localeCompare(b.event_date_start)
  );

  const bySource = new Map<string, number>();
  let ongoingCount = 0;
  const picked = new Set<string>();

  for (const event of ranked) {
    if (picked.size >= MAX_WINDOW_EVENTS) break;
    const isOngoing = event.event_date_start.slice(0, 10) < windowStart;
    if (isOngoing && ongoingCount >= MAX_ONGOING) continue;
    const sourceCount = bySource.get(event.source) ?? 0;
    if (sourceCount >= MAX_PER_SOURCE) continue;

    picked.add(event.id);
    bySource.set(event.source, sourceCount + 1);
    if (isOngoing) ongoingCount++;
  }

  // Preserve the query's chronological order for display.
  return rows.filter((e) => picked.has(e.id));
}
