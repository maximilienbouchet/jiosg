import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

/**
 * Ticketmaster Singapore — the official box office for arena tours, big-name
 * concerts and major theatre runs. This is jio's coverage for "established"
 * shows (The Weeknd, Post Malone, Cirque-scale productions) that never appear
 * on Eventbrite/Peatix.
 *
 * Only the server-rendered *table* listings are scraped:
 *   - /activity?type=table            (all categories, first page)
 *   - /categories/{slug}?type=table   (per-category, first page)
 *
 * Deliberately NOT used:
 *   - /activity/get-more-game-list (AJAX pagination) — Disallow in robots.txt
 *     AND behind Ticketmaster's bot challenge (HTTP 401).
 *   - ?startDate=/&endDate= date-window enumeration — `Disallow: *startDate=*`.
 *   - /activity/detail/* pages — HTTP 401 {"response":"identify"} for any
 *     non-browser client, so no event synopsis is obtainable. Descriptions are
 *     synthesised from category + venue + session dates instead (see
 *     buildDescription) which also keeps lib/enrich.ts from wasting a request
 *     on a URL that always 401s.
 *
 * Net effect: forward horizon is capped at whatever fits on page 1 of each
 * listing (~3.5 months), which is ample for a rolling 7-day product.
 */

const BASE_URL = "https://ticketmaster.sg";
const USER_AGENT = "SGEventsCuration/1.0";
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_DELAY_MS = 300;

interface Listing {
  url: string;
  /** Category label used to synthesise a description. Null = mixed listing. */
  category: string | null;
  /** Required listings throw when they come back empty; the rest only warn. */
  required: boolean;
}

const LISTINGS: Listing[] = [
  { url: `${BASE_URL}/activity?type=table`, category: null, required: true },
  { url: `${BASE_URL}/categories/concerts?type=table`, category: "concerts", required: false },
  { url: `${BASE_URL}/categories/arts-theatre-comedy?type=table`, category: "arts-theatre-comedy", required: false },
  { url: `${BASE_URL}/categories/family-entertainment?type=table`, category: "family-entertainment", required: false },
  // Empty at time of writing ("Stay tuned") — kept so it starts working the
  // day Ticketmaster lists a sports event.
  { url: `${BASE_URL}/categories/sports?type=table`, category: "sports", required: false },
];

const CATEGORY_LABELS: Record<string, string> = {
  concerts: "Live concert",
  "arts-theatre-comedy": "Theatre, comedy or performing arts show",
  "family-entertainment": "Family entertainment show",
  sports: "Live sports event",
};

const DEFAULT_CATEGORY_LABEL = "Ticketed live event";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Ticketmaster.sg is the Singapore box office, but it occasionally cross-sells
 * a regional show. Venue names are the reliable signal — anything naming a
 * foreign city/country is dropped (and logged) before it reaches the LLM.
 */
const FOREIGN_VENUE_MARKERS = [
  "kuala lumpur", "malaysia", "genting", "johor", "penang",
  "bangkok", "thailand", "jakarta", "indonesia", "bali",
  "manila", "philippines", "hong kong", "macau", "taipei", "taiwan",
  "tokyo", "japan", "seoul", "korea", "shanghai", "beijing",
  "australia", "sydney", "melbourne", "india", "mumbai", "vietnam", "hanoi",
];

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** "05 Sep 2026 (Sat.) 02:30 pm" → "2026-09-05" */
function parseSingleDate(part: string, fallbackYear: number | null): string | null {
  const match = part.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*(\d{4})?/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const year = match[3] ? Number(match[3]) : fallbackYear;
  if (!month || !year || !isRealDate(year, month, day)) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Listing rows carry either a single session ("05 Sep 2026 (Sat.) 02:30 pm")
 * or a run ("17 Dec 2026 (Thu.) ~ 22 Dec 2026 (Tue.)"). Returns every date the
 * row covers as ISO strings — endpoints only, not the days in between.
 */
export function parseTicketmasterDate(text: string): string[] | null {
  const parts = normalize(text).split("~").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const start = parseSingleDate(parts[0], null);
  if (!start) return null;
  if (parts.length === 1) return [start];

  const end = parseSingleDate(parts[1], Number(start.slice(0, 4)));
  // A half-parsed range is a parse failure, not a single-day event — the caller
  // logs it rather than silently truncating the run.
  if (!end || end < start) return null;

  return end === start ? [start] : [start, end];
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

export interface TicketmasterRow {
  slug: string;
  sourceUrl: string;
  title: string;
  venue: string;
  category: string | null;
  dates: string[];
}

export interface TicketmasterEvent {
  slug: string;
  sourceUrl: string;
  title: string;
  venue: string;
  description: string;
  dateStart: string;
  dateEnd: string | null;
  /** Every listed session date, ascending. */
  sessions: string[];
}

/**
 * Detail pages are bot-blocked, so this is all the context the LLM gets.
 * Always >= 100 chars so lib/enrich.ts skips the (guaranteed 401) fetch.
 */
function buildDescription(event: {
  venue: string;
  category: string | null;
  sessions: string[];
}): string {
  const label = event.category
    ? (CATEGORY_LABELS[event.category] ?? DEFAULT_CATEGORY_LABEL)
    : DEFAULT_CATEGORY_LABEL;

  const sessions = event.sessions;
  let when: string;
  if (sessions.length === 1) {
    when = `One session: ${formatDate(sessions[0])}.`;
  } else if (sessions.length <= 6) {
    when = `${sessions.length} sessions: ${sessions.map(formatDate).join(", ")}.`;
  } else {
    when =
      `${sessions.length} sessions from ${formatDate(sessions[0])} ` +
      `to ${formatDate(sessions[sessions.length - 1])}.`;
  }

  return (
    `${label} at ${event.venue}, Singapore. ` +
    `On sale through Ticketmaster Singapore, the official box office for ` +
    `touring acts, arena shows and major theatre runs. ${when}`
  );
}

/**
 * Parse one listing page. Exported so the probe can drive the structural
 * guards from fixtures without hitting the network.
 *
 * Throws when the page is structurally wrong (markup moved, rows present but
 * nothing parseable); returns [] only for Ticketmaster's own empty-state.
 */
export function parseTicketmasterListing(
  html: string,
  pageUrl: string,
  category: string | null
): TicketmasterRow[] {
  const $ = cheerio.load(html);
  const rows = $("div.eventbl");

  if (rows.length === 0) {
    // An empty catalogue renders an alert instead of the .event-list wrapper
    // (the sports category does this today). Anything else — including the
    // /categories redirect a renamed slug lands on — means the markup moved,
    // and we must not pretend the source is simply quiet.
    const emptyState = $(".listing-container .alert").length > 0;
    if ($(".event-list").length > 0 || !emptyState) {
      throw new Error(
        `[ticketmaster] No div.eventbl rows at ${pageUrl} and no empty-state alert — markup changed`
      );
    }
    console.warn(`[ticketmaster] ${pageUrl} lists no events (empty-state alert)`);
    return [];
  }

  const parsed: TicketmasterRow[] = [];
  const unparseable: string[] = [];

  rows.each((_, el) => {
    const row = $(el);

    const href = row.find("a[href*='/activity/detail/']").first().attr("href") ?? "";
    const slug = href.match(/\/activity\/detail\/([A-Za-z0-9_.-]+)/)?.[1];
    if (!slug) {
      unparseable.push(`no detail link (href="${href}")`);
      return;
    }

    // Titles carry a <br/> before the subtitle — turn it into a space so
    // ".text()" doesn't glue words together.
    const link = row.find(".text-bold a").first();
    link.find("br").replaceWith(" ");
    const title = normalize(link.text());
    // Ticketmaster ships unescaped angle brackets in titles ("ITZY 3RD WORLD
    // TOUR < TUNNEL VISION >"). With a space after "<" the parser keeps them as
    // text; without one it would invent a phantom element and eat part of the
    // title. Any leftover child element is that failure mode — say so loudly.
    if (link.children().length > 0) {
      console.warn(
        `[ticketmaster] ${slug}: title link contains markup, may be truncated — "${title}"`
      );
    }

    const venue = normalize(row.find(".text-med-light").first().text());
    const dateText = row.find(".date").first().text();
    const dates = parseTicketmasterDate(dateText);

    if (!title || !venue || !dates) {
      unparseable.push(
        `${slug}: title="${title}" venue="${venue}" date="${normalize(dateText)}"`
      );
      return;
    }

    parsed.push({
      slug,
      // Rebuild from the slug so the dedupe key can't drift on tracking params.
      sourceUrl: `${BASE_URL}/activity/detail/${slug}`,
      title,
      venue,
      category,
      dates,
    });
  });

  if (unparseable.length > 0) {
    console.warn(
      `[ticketmaster] ${pageUrl}: skipped ${unparseable.length}/${rows.length} unparseable rows:\n  ` +
        unparseable.slice(0, 10).join("\n  ")
    );
  }

  if (parsed.length === 0) {
    throw new Error(
      `[ticketmaster] Found ${rows.length} div.eventbl rows at ${pageUrl} but parsed 0 events`
    );
  }

  return parsed;
}

async function fetchListing(listing: Listing): Promise<TicketmasterRow[]> {
  const response = await fetch(listing.url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`[ticketmaster] ${listing.url} returned ${response.status}`);
  }
  return parseTicketmasterListing(await response.text(), listing.url, listing.category);
}

/**
 * Fetch + parse every listing and fold multi-session rows into one event per
 * slug. Pure: no database access, so the probe script can exercise exactly
 * this code path.
 */
export async function collectTicketmasterEvents(
  todayIso = new Date().toISOString().slice(0, 10)
): Promise<TicketmasterEvent[]> {
  const bySlug = new Map<string, TicketmasterRow & { dateSet: Set<string> }>();
  let rowCount = 0;

  for (const [index, listing] of LISTINGS.entries()) {
    if (index > 0) await sleep(PAGE_DELAY_MS);

    const rows = await fetchListing(listing);
    rowCount += rows.length;

    for (const row of rows) {
      const existing = bySlug.get(row.slug);
      if (existing) {
        // Same show appears once per session, and again on the mixed listing.
        for (const d of row.dates) existing.dateSet.add(d);
        // The mixed listing has no category; a category page wins.
        if (!existing.category && row.category) existing.category = row.category;
      } else {
        bySlug.set(row.slug, { ...row, dateSet: new Set(row.dates) });
      }
    }
  }

  if (bySlug.size === 0) {
    const required = LISTINGS.filter((l) => l.required).map((l) => l.url).join(", ");
    throw new Error(
      `[ticketmaster] Parsed 0 events across ${LISTINGS.length} listings (required: ${required})`
    );
  }

  const events: TicketmasterEvent[] = [];
  let pastCount = 0;
  let foreignCount = 0;

  for (const row of bySlug.values()) {
    const sessions = [...row.dateSet].sort();
    const dateStart = sessions[0];
    const dateEnd = sessions.length > 1 ? sessions[sessions.length - 1] : null;

    // Drop only fully-finished runs; an in-progress multi-day run still shows.
    if ((dateEnd ?? dateStart) < todayIso) {
      pastCount++;
      continue;
    }

    const venueLower = row.venue.toLowerCase();
    const foreign = FOREIGN_VENUE_MARKERS.find((m) => venueLower.includes(m));
    if (foreign) {
      foreignCount++;
      console.log(`[ticketmaster] Skipping non-SG event: ${row.title} @ ${row.venue}`);
      continue;
    }

    events.push({
      slug: row.slug,
      sourceUrl: row.sourceUrl,
      title: row.title,
      venue: row.venue,
      description: buildDescription({
        venue: row.venue,
        category: row.category,
        sessions,
      }),
      dateStart,
      dateEnd,
      sessions,
    });
  }

  events.sort((a, b) => a.dateStart.localeCompare(b.dateStart));

  console.log(
    `[ticketmaster] ${rowCount} listing rows → ${bySlug.size} unique events ` +
      `(${pastCount} past, ${foreignCount} non-SG skipped) → ${events.length} upcoming`
  );

  return events;
}

export async function scrapeTicketmaster(): Promise<number> {
  await initializeDb();

  const events = await collectTicketmasterEvents();
  let newEvents = 0;

  for (const event of events) {
    const result = await upsertEvent({
      source: "ticketmaster",
      source_url: event.sourceUrl,
      raw_title: event.title,
      raw_description: event.description,
      venue: event.venue,
      event_date_start: event.dateStart,
      event_date_end: event.dateEnd,
    });

    if (result.inserted) newEvents++;
  }

  console.log(
    `[ticketmaster] Found ${events.length} upcoming events, scraped ${newEvents} new events`
  );
  return newEvents;
}
