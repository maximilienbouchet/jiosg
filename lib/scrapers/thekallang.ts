import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

const BASE_URL = "https://www.thekallang.com.sg";
// The old /events path 301-redirects here. The listing is an AEM "cardListing"
// component: the complete event list is embedded server-side as JSON in a
// data-props attribute, and the page filters/paginates it client-side. There is
// no server-side pagination (?page=N returns the identical payload) and no
// .model.json feed, so a single request yields every upcoming event.
const CALENDAR_URL = `${BASE_URL}/en/things-to-do/events.html`;
const USER_AGENT = "SGEventsCuration/1.0";
const FETCH_TIMEOUT_MS = 20_000;
// Keep events that started recently so multi-day runs already in progress are
// not dropped mid-run.
const PAST_CUTOFF_DAYS = 7;

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/** Shape of a card inside the cardListing data-props payload. */
interface KallangCard {
  title?: string;
  description?: string;
  displayDate?: string;
  dates?: string[];
  venue?: string;
  webDetailPath?: string;
}

interface KallangProps {
  cardList?: KallangCard[];
  featuredCardList?: KallangCard[];
}

export interface ParsedKallangEvent {
  title: string;
  description: string | null;
  venue: string;
  dateStart: string;
  dateEnd: string | null;
  sourceUrl: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fallback for cards that carry only a human-readable date string (featured
 * cards omit the ISO `dates` array). Handles "22 Aug 2026", "21 - 27 Sep 2026",
 * "7 & 8 Nov 2026" and cross-month ranges like "28 Nov - 2 Dec 2026" by letting
 * each part inherit the month/year of the part to its right.
 */
export function parseDisplayDate(text: string): string[] | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || /multiple/i.test(cleaned)) return null;

  const parts = cleaned
    .split(/\s*(?:-|–|—|&|\bto\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;

  const fragments: { day: string; month?: string; year?: string }[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{4}))?/);
    if (!m) return null;
    const month = m[2] ? MONTH_MAP[m[2].toLowerCase()] : undefined;
    if (m[2] && !month) return null;
    fragments.push({ day: m[1], month, year: m[3] });
  }

  // Inherit missing month/year from the right ("21 - 27 Sep 2026" → 21 Sep 2026).
  let month: string | undefined;
  let year: string | undefined;
  for (let i = fragments.length - 1; i >= 0; i--) {
    month = fragments[i].month ?? month;
    year = fragments[i].year ?? year;
    fragments[i].month = month;
    fragments[i].year = year;
  }

  const dates = fragments.map((f) =>
    f.month && f.year ? `${f.year}-${f.month}-${f.day.padStart(2, "0")}` : null
  );
  if (dates.some((d) => d === null)) return null;
  return dates as string[];
}

/** Collect the ISO dates for a card, preferring the structured `dates` array. */
function cardDates(card: KallangCard): string[] | null {
  const iso = (card.dates ?? []).filter((d) => typeof d === "string" && ISO_DATE_RE.test(d));
  if (iso.length > 0) return [...iso].sort();
  if (card.displayDate) {
    const fallback = parseDisplayDate(card.displayDate);
    if (fallback && fallback.length > 0) return [...fallback].sort();
  }
  return null;
}

/**
 * The payload is plain text, not HTML — angle brackets are stylistic tour-name
 * quoting ("ITZY 3rd World Tour <TUNNEL VISION>"), so they must be preserved
 * rather than stripped as markup. Only whitespace is normalised.
 */
function cleanText(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

/**
 * Fetch the listing and parse it into events. Pure: performs no database work,
 * so the probe script can exercise the exact same code path.
 *
 * Throws on structural failure (bad HTTP status, missing component, missing
 * payload, or cards present but none parseable) so breakage surfaces loudly
 * instead of silently reporting zero events.
 */
export async function fetchKallangEvents(): Promise<ParsedKallangEvent[]> {
  const response = await fetch(CALENDAR_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`[thekallang] ${CALENDAR_URL} returned ${response.status}`);
  }
  const html = await response.text();

  const $ = cheerio.load(html);
  const listing = $('[data-cmp-is="cardListing"]').first();
  if (listing.length === 0) {
    throw new Error(
      "[thekallang] No cardListing component found — page structure changed"
    );
  }

  const rawProps = listing.attr("data-props");
  if (!rawProps) {
    throw new Error("[thekallang] cardListing component has no data-props payload");
  }

  let props: KallangProps;
  try {
    props = JSON.parse(rawProps) as KallangProps;
  } catch (err) {
    throw new Error(`[thekallang] Failed to parse data-props JSON: ${err}`);
  }

  if (!Array.isArray(props.cardList)) {
    throw new Error("[thekallang] data-props has no cardList array");
  }

  // Featured cards are normally repeated in cardList; merge by path so a
  // featured-only event is never missed.
  const cards: KallangCard[] = [...props.cardList];
  const seenPaths = new Set(cards.map((c) => c.webDetailPath).filter(Boolean));
  for (const featured of props.featuredCardList ?? []) {
    if (featured.webDetailPath && !seenPaths.has(featured.webDetailPath)) {
      seenPaths.add(featured.webDetailPath);
      cards.push(featured);
    }
  }

  if (cards.length === 0) {
    // Genuine empty state — the site renders a "No events found" message here.
    console.warn("[thekallang] Listing contains no events");
    return [];
  }

  const cutoff = daysAgo(PAST_CUTOFF_DAYS);
  const events: ParsedKallangEvent[] = [];
  let parsedCards = 0;

  for (const card of cards) {
    const title = cleanText(card.title);
    const path = card.webDetailPath;
    if (!title || !path) {
      console.warn(`[thekallang] Skipping card missing title or path: "${card.title ?? ""}"`);
      continue;
    }

    const dates = cardDates(card);
    if (!dates) {
      console.warn(
        `[thekallang] Could not parse dates for "${title}": displayDate="${card.displayDate ?? ""}"`
      );
      continue;
    }
    parsedCards++;

    // Series can list dates months apart; drop the ones already past so the
    // event surfaces at its next occurrence rather than its first ever.
    const upcoming = dates.filter((d) => d >= cutoff);
    if (upcoming.length === 0) continue;

    const dateStart = upcoming[0];
    const lastDate = upcoming[upcoming.length - 1];
    const dateEnd = lastDate !== dateStart ? lastDate : null;

    // A gappy series ("Multiple dates") is stored as a span, so record the real
    // dates in the description for the LLM and for the admin panel.
    let description = cleanText(card.description);
    const isContiguous = upcoming.every((d, i) => i === 0 || d === addDays(upcoming[i - 1], 1));
    if (upcoming.length > 2 && !isContiguous) {
      const dateList = `Event dates: ${upcoming.join(", ")}.`;
      description = description ? `${description} ${dateList}` : dateList;
    }

    events.push({
      title,
      description,
      venue: cleanText(card.venue) ?? "The Kallang",
      dateStart,
      dateEnd,
      sourceUrl: path.startsWith("http") ? path : `${BASE_URL}${path}`,
    });
  }

  if (parsedCards === 0) {
    throw new Error(
      `[thekallang] Found ${cards.length} cards but parsed 0 — payload format changed`
    );
  }

  return events;
}

export async function scrapeTheKallang(): Promise<number> {
  await initializeDb();

  const events = await fetchKallangEvents();
  let newEvents = 0;

  for (const event of events) {
    const result = await upsertEvent({
      source: "thekallang",
      source_url: event.sourceUrl,
      raw_title: event.title,
      raw_description: event.description,
      venue: event.venue,
      event_date_start: event.dateStart,
      event_date_end: event.dateEnd,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(
    `[thekallang] Parsed ${events.length} upcoming events, ${newEvents} new`
  );
  return newEvents;
}
