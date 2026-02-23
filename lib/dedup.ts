import {
  getUnprocessedNonDuplicateEvents,
  getPotentialDuplicateTargets,
  markAsDuplicate,
  type EventRow,
} from "./db";

// --- Title normalization & matching ---

const TITLE_STOP_WORDS = new Set([
  "the", "a", "an", "in", "at", "of", "and", "for", "to", "singapore", "sg",
]);

const YEAR_PATTERN = /^20\d{2}$/;

export function normalizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !TITLE_STOP_WORDS.has(w) && !YEAR_PATTERN.test(w));
}

export function titlesMatch(titleA: string, titleB: string): boolean {
  const wordsA = normalizeTitle(titleA);
  const wordsB = normalizeTitle(titleB);

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  // Word-set containment: every word in the shorter title appears in the longer
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerSet = new Set(longer);
  if (shorter.every((w) => longerSet.has(w))) return true;

  // Shared words threshold
  const setA = new Set(wordsA);
  const shared = wordsB.filter((w) => setA.has(w)).length;
  const minLength = Math.min(wordsA.length, wordsB.length);
  const threshold = minLength < 4 ? 2 : 3;

  return shared >= threshold;
}

// --- Venue normalization & matching ---

const VENUE_STOP_WORDS = new Set([
  "the", "at", "of", "and", "singapore", "sg",
  "centre", "center", "hall", "room", "studio",
]);

export function normalizeVenue(venue: string): string[] {
  return venue
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !VENUE_STOP_WORDS.has(w));
}

export function venuesMatch(venueA: string, venueB: string): boolean {
  const wordsA = normalizeVenue(venueA);
  const wordsB = normalizeVenue(venueB);

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  // Word-set containment
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerSet = new Set(longer);
  if (shorter.every((w) => longerSet.has(w))) return true;

  // Shared words: 2+ in common
  const setA = new Set(wordsA);
  const shared = wordsB.filter((w) => setA.has(w)).length;

  return shared >= 2;
}

// --- Date overlap ---

export function datesOverlap(eventA: EventRow, eventB: EventRow): boolean {
  const startA = eventA.event_date_start.slice(0, 10);
  const endA = (eventA.event_date_end ?? eventA.event_date_start).slice(0, 10);
  const startB = eventB.event_date_start.slice(0, 10);
  const endB = (eventB.event_date_end ?? eventB.event_date_start).slice(0, 10);

  return startA <= endB && startB <= endA;
}

// --- Composite check ---

export function eventsAreDuplicates(a: EventRow, b: EventRow): boolean {
  return titlesMatch(a.raw_title, b.raw_title) &&
    datesOverlap(a, b) &&
    venuesMatch(a.venue, b.venue);
}

// --- Canonical selection ---

function chooseCanonical(a: EventRow, b: EventRow): { canonical: EventRow; duplicate: EventRow } {
  // Already-processed event wins
  if (a.llm_included !== null && b.llm_included === null) return { canonical: a, duplicate: b };
  if (b.llm_included !== null && a.llm_included === null) return { canonical: b, duplicate: a };

  // Longer raw_description wins
  const descA = (a.raw_description ?? "").length;
  const descB = (b.raw_description ?? "").length;
  if (descA !== descB) {
    return descA > descB ? { canonical: a, duplicate: b } : { canonical: b, duplicate: a };
  }

  // Tie-break: earlier created_at
  return a.created_at <= b.created_at ? { canonical: a, duplicate: b } : { canonical: b, duplicate: a };
}

// --- Orchestrator ---

export interface DedupPair {
  duplicateId: string;
  duplicateTitle: string;
  duplicateSource: string;
  canonicalId: string;
  canonicalTitle: string;
  canonicalSource: string;
}

export interface DedupResult {
  marked: number;
  pairs: DedupPair[];
}

export async function runDeduplication(): Promise<DedupResult> {
  const unprocessed = await getUnprocessedNonDuplicateEvents();
  if (unprocessed.length === 0) return { marked: 0, pairs: [] };

  // Compute date range from unprocessed events
  const dates = unprocessed.map((e) => e.event_date_start.slice(0, 10));
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  // Fetch all non-duplicate events in the date window (includes processed ones)
  const targets = await getPotentialDuplicateTargets(minDate, maxDate);

  const markedIds = new Set<string>();
  const pairs: DedupPair[] = [];

  // Phase 1: Compare unprocessed against already-processed events
  const processed = targets.filter((e) => e.llm_included !== null);
  for (const event of unprocessed) {
    if (markedIds.has(event.id)) continue;
    for (const target of processed) {
      if (target.id === event.id) continue;
      if (eventsAreDuplicates(event, target)) {
        await markAsDuplicate(event.id, target.id);
        markedIds.add(event.id);
        pairs.push({
          duplicateId: event.id,
          duplicateTitle: event.raw_title,
          duplicateSource: event.source,
          canonicalId: target.id,
          canonicalTitle: target.raw_title,
          canonicalSource: target.source,
        });
        break;
      }
    }
  }

  // Phase 2: Compare remaining unprocessed events against each other
  const remaining = unprocessed.filter((e) => !markedIds.has(e.id));
  for (let i = 0; i < remaining.length; i++) {
    if (markedIds.has(remaining[i].id)) continue;
    for (let j = i + 1; j < remaining.length; j++) {
      if (markedIds.has(remaining[j].id)) continue;
      if (eventsAreDuplicates(remaining[i], remaining[j])) {
        const { canonical, duplicate } = chooseCanonical(remaining[i], remaining[j]);
        await markAsDuplicate(duplicate.id, canonical.id);
        markedIds.add(duplicate.id);
        pairs.push({
          duplicateId: duplicate.id,
          duplicateTitle: duplicate.raw_title,
          duplicateSource: duplicate.source,
          canonicalId: canonical.id,
          canonicalTitle: canonical.raw_title,
          canonicalSource: canonical.source,
        });
      }
    }
  }

  return { marked: markedIds.size, pairs };
}
