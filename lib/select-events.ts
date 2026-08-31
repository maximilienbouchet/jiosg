import type { EventRow, WindowPickRow } from "./db";

// The spec promises ~10 curated events per week — never pad, never flood.
// Publishing (score >= 7) decides what is ELIGIBLE; this layer decides what is
// SHOWN. Two modes:
//
//  1. Editorial (preferred): the nightly editor pass (lib/llm.ts runEditorPass)
//     ranked this window's events in context; we show that lineup. Applied by
//     INTERSECTION — picks are filtered to the rows actually fetched, so an
//     admin unpublishing one pick, or a narrower request window (e.g. the MCP
//     weekend tool), degrades gracefully instead of discarding the ordering.
//  2. Deterministic (fallback + filler): score ranking with per-source and
//     ongoing caps. Runs when no picks exist (arrow-navigated weeks, editor
//     failure, Monday before the 03:10 SGT cron) and fills remaining slots
//     after the editorial intersection.
//
// Selection is display-time only: everything stays in the DB and admin panel.
const MAX_WINDOW_EVENTS = 12;
// One venue's programme (e.g. a rep cinema's weekly slate) must not dominate.
const MAX_PER_SOURCE = 4;
// Long-running exhibitions overlap every window; without a limit they would
// permanently occupy slots that belong to the week's fresh events.
const MAX_ONGOING = 4;

// Manual adds carry no llm_score; an admin published them deliberately, so
// rank them as solid (7) rather than sinking them below every scored event.
const scoreOf = (e: EventRow) => e.llm_score ?? 7;

function deterministicOrder(rows: EventRow[]): EventRow[] {
  return [...rows].sort(
    (a, b) =>
      scoreOf(b) - scoreOf(a) ||
      b.is_heads_up - a.is_heads_up ||
      a.event_date_start.localeCompare(b.event_date_start)
  );
}

export function selectWindowEvents(
  rows: EventRow[],
  windowStart: string,
  picks?: WindowPickRow[]
): EventRow[] {
  // Under capacity there is nothing to select — show every eligible event.
  // (Editorial rank still reaches the UI via the API's rank decoration.)
  if (rows.length <= MAX_WINDOW_EVENTS) return rows;

  const byId = new Map(rows.map((e) => [e.id, e]));

  // Editorial intersection: picked events present in this window, rank order.
  const pickedIds: string[] = [];
  if (picks && picks.length > 0) {
    for (const p of [...picks].sort((a, b) => a.rank - b.rank)) {
      if (byId.has(p.event_id) && pickedIds.length < MAX_WINDOW_EVENTS) {
        pickedIds.push(p.event_id);
      }
    }
  }

  const picked = new Set<string>(pickedIds);
  const bySource = new Map<string, number>();
  let ongoingCount = 0;

  // Editorial picks count against the caps so the deterministic fill can't
  // pile more events onto an already well-represented source.
  for (const id of pickedIds) {
    const event = byId.get(id)!;
    bySource.set(event.source, (bySource.get(event.source) ?? 0) + 1);
    if (event.event_date_start.slice(0, 10) < windowStart) ongoingCount++;
  }

  // Deterministic fill for the remaining slots (all slots when no picks).
  for (const event of deterministicOrder(rows)) {
    if (picked.size >= MAX_WINDOW_EVENTS) break;
    if (picked.has(event.id)) continue;
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

/**
 * The single event the UI should feature as "pick of the week": the lowest
 * surviving editorial rank, or the deterministic top of the SELECTED rows when
 * no picks exist (never an event that isn't shown — no 13-event weeks).
 */
export function pickHeroId(selectedRows: EventRow[], picks?: WindowPickRow[]): string | null {
  if (selectedRows.length === 0) return null;

  if (picks && picks.length > 0) {
    const present = new Set(selectedRows.map((e) => e.id));
    const surviving = [...picks].sort((a, b) => a.rank - b.rank).find((p) => present.has(p.event_id));
    if (surviving) return surviving.event_id;
  }

  return deterministicOrder(selectedRows)[0].id;
}
