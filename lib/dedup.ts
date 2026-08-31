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
    // Keep letters/digits from any script — `\w` is ASCII-only and would strip
    // CJK titles down to nothing, which matters for Chinese-language events.
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !TITLE_STOP_WORDS.has(w) && !YEAR_PATTERN.test(w));
}

/**
 * Titles refer to the same event.
 *
 * Uses *proportional* overlap, not an absolute shared-word count. Series titles
 * ("Holiday Art Immersion - Manga Drawing" vs "Holiday Art Immersion - Acrylic
 * Painting") share plenty of words while being genuinely different events, so a
 * flat "3 words in common" threshold collapses a whole programme into one entry.
 */
export function titlesMatch(titleA: string, titleB: string): boolean {
  const setA = new Set(normalizeTitle(titleA));
  const setB = new Set(normalizeTitle(titleB));

  if (setA.size === 0 || setB.size === 0) return false;

  const [shorter, longer] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

  // One title is a shortened form of the other ("Anoushka Shankar" vs
  // "Anoushka Shankar Live in Concert"). Require the shorter to carry real
  // signal and to make up a decent share of the longer, so that a generic
  // series prefix does not swallow every event under it.
  const isContained = [...shorter].every((w) => longer.has(w));
  if (isContained && shorter.size >= 2 && shorter.size / longer.size >= 0.5) {
    return true;
  }

  // Otherwise require substantial overlap in both directions (Jaccard).
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  const union = setA.size + setB.size - shared;

  return union > 0 && shared / union >= 0.6;
}

// --- Venue normalization & matching ---

const VENUE_STOP_WORDS = new Set([
  "the", "at", "of", "and", "singapore", "sg",
  "centre", "center", "hall", "room", "studio",
]);

export function normalizeVenue(venue: string): string[] {
  return venue
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
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

  // Same venue complex, different granularity: sources name the building
  // ("Esplanade - Theatres on the Bay") or the room ("Esplanade Concert Hall").
  // A shared distinctive leading token means the same complex.
  if (wordsA[0] === wordsB[0] && wordsA[0].length >= 4) return true;

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

/**
 * Both titles reduce to exactly the same set of significant words. Used for the
 * same-source gate, where any exact match counts — a site restructure can list
 * one show under two URLs, including one-word titles ("Tortoise").
 */
function normalizedTitlesEqual(titleA: string, titleB: string): boolean {
  const wordsA = normalizeTitle(titleA);
  const wordsB = normalizeTitle(titleB);
  if (wordsA.length === 0 || wordsA.length !== wordsB.length) return false;
  const setB = new Set(wordsB);
  return wordsA.every((w) => setB.has(w));
}

/**
 * Same as above but demands 3+ significant words — distinctive enough that a
 * same-day match is the same event regardless of venue string.
 */
function titlesAreIdentical(titleA: string, titleB: string): boolean {
  return normalizeTitle(titleA).length >= 3 && normalizedTitlesEqual(titleA, titleB);
}

export function eventsAreDuplicates(a: EventRow, b: EventRow): boolean {
  if (!datesOverlap(a, b)) return false;
  if (!titlesMatch(a.raw_title, b.raw_title)) return false;

  // Fuzzy title matching exists to absorb how *different* sources word the same
  // event. Within one source, near-misses are almost always genuinely different
  // events from the same programme ("...Acrylic Painting" vs "...Watercolour
  // Painting"), so demand an exact title match there. Exact re-listings — the
  // real same-source duplicate, e.g. one show under an old and a new URL after
  // a site restructure — still qualify.
  if (a.source === b.source && !normalizedTitlesEqual(a.raw_title, b.raw_title)) {
    return false;
  }

  if (venuesMatch(a.venue, b.venue)) return true;

  // Venue strings can differ beyond recognition across sources (a ticketing
  // platform lists "Esplanade - Theatres on the Bay", the venue lists
  // "Esplanade Concert Hall"). An identical distinctive title on the same
  // start date is sufficient on its own.
  return (
    titlesAreIdentical(a.raw_title, b.raw_title) &&
    a.event_date_start.slice(0, 10) === b.event_date_start.slice(0, 10)
  );
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
