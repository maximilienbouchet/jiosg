import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

// sagg.info (Singapore Art Gallery Guide) is the only place that indexes every
// museum and commercial-gallery show in the city in one list. jio had no visual
// art source at all: museum shows only surfaced when they happened to be
// ticketed elsewhere, and the gallery scene (Cuturi, STPI, Gajah, Yeo Workshop,
// Sullivan+Strumpf, ShanghART) was completely invisible.
//
// Two server-rendered listings, no pagination: the theme ignores ?paged and
// re-serves page 1 verbatim, so looping pages only duplicates work. Everything
// is on page 1 — 104 shows today.
const LISTING_URLS = [
  // Currently open. /events/?event_type=exhibition 301s to this canonical form,
  // so request it directly and skip the redirect hop.
  "https://sagg.info/?event_type=exhibition",
  // Announced but not yet open. Disjoint from the list above.
  "https://sagg.info/?event_range=upcoming",
];
const ORIGIN = "https://sagg.info";
const USER_AGENT = "SGEventsCuration/1.0";
// Observed ~3.5s per page; the ceiling keeps two sequential fetches well inside
// the 50s per-scraper cap in index.ts.
const FETCH_TIMEOUT_MS = 15_000;

// sagg prints "n/a" as the venue when it doesn't know one (9 of 104 today, and
// the detail page has no better answer). "n/a" would be rendered verbatim under
// the event title, so use something honest instead.
const UNKNOWN_VENUE = /^n\.?\/?a\.?$/i;
const VENUE_FALLBACK = "Singapore";

// Every listing is a Singapore venue by definition — this is a Singapore-only
// guide — so no geographic filtering is needed at scrape level.

// sagg indexes permanent museum displays alongside real exhibitions: "Indians
// in Singapore: Past & Present" has been on since 2015, "Future World" since
// 2016, "Laws of Our Land" runs to 2030. Those are attractions, not events, and
// letting them in would burn an enrichment fetch plus two Haiku calls each and
// then compete for the four ongoing slots every single week. Two years is well
// clear of even the longest real show here (18 months), so this drops fixtures
// without making a taste call — that stays the LLM's job. An admin who wants
// one can still add it by URL.
const MAX_RUN_DAYS = 730;

// SPEC section 6 excludes online-only events outright, whatever their length.
const ONLINE_ONLY = /\bonline\s+(?:exhibition|showcase|screening|viewing\s+room)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// Card excerpt is a single line, "DATE RANGE, VENUE". The year is the anchor:
// matching lazily up to the first "<year>," keeps venues that contain commas
// ("Urban Redevelopment Authority, Singapore City Gallery") or four-digit names
// ("Gallery 1819") intact.
const DATE_VENUE_RE = /^(.+?\d{4}),\s*(.+)$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** A day, plus whatever month/year the site chose to print alongside it. */
interface DateFragment {
  day: number;
  month: number | null;
  year: number | null;
}

function parseFragment(text: string): DateFragment | null {
  const match = text.trim().match(/^(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{4}))?$/);
  if (!match) return null;

  const day = Number(match[1]);
  if (day < 1 || day > 31) return null;

  let month: number | null = null;
  if (match[2]) {
    month = MONTHS[match[2].toLowerCase()] ?? null;
    if (month === null) return null; // a word we don't recognise means drift
  }

  return { day, month, year: match[3] ? Number(match[3]) : null };
}

/** Rejects impossible calendar dates (31 Sep, 30 Feb) rather than rolling over. */
function toIsoDate(day: number, month: number, year: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Parse sagg's three date-range shapes. The end date is always fully qualified;
 * the start prints only what the end doesn't already imply:
 *
 *   "1 - 6 Sep 2026"            same month  → 2026-09-01 … 2026-09-06
 *   "5 Sep - 11 Oct 2026"       same year   → 2026-09-05 … 2026-10-11
 *   "18 Sep 2026 - 7 Mar 2027"  cross year  → 2026-09-18 … 2027-03-07
 *
 * A bare single date is also handled defensively (end = null), though the
 * listing always prints a range today.
 */
export function parseSaggDateRange(
  range: string
): { start: string; end: string | null } | null {
  const parts = range
    .split(/\s*[-–—]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const only = parseFragment(parts[0]);
    if (!only || only.month === null || only.year === null) return null;
    const start = toIsoDate(only.day, only.month, only.year);
    return start ? { start, end: null } : null;
  }

  if (parts.length !== 2) return null;

  const endFragment = parseFragment(parts[1]);
  if (!endFragment || endFragment.month === null || endFragment.year === null) return null;
  const startFragment = parseFragment(parts[0]);
  if (!startFragment) return null;

  const end = toIsoDate(endFragment.day, endFragment.month, endFragment.year);
  if (!end) return null;

  const startMonth = startFragment.month ?? endFragment.month;
  const yearInherited = startFragment.year === null;
  let startYear = startFragment.year ?? endFragment.year;

  // Inheriting the end's year breaks on a December→March run written without an
  // explicit start year ("18 Dec - 7 Mar 2027"). The site fully qualifies those
  // today, but roll back a year if the inherited value lands after the end.
  if (yearInherited && startMonth > endFragment.month) startYear -= 1;

  const start = toIsoDate(startFragment.day, startMonth, startYear);
  if (!start || start > end) return null;

  return { start, end: start === end ? null : end };
}

export interface SaggEvent {
  url: string;
  title: string;
  venue: string;
  start: string;
  end: string | null;
}

function parseListing(html: string, listingUrl: string): SaggEvent[] {
  const $ = cheerio.load(html);
  const cards = $("div.st-category-wrapper");

  if (cards.length === 0) {
    // Could be a genuinely empty "upcoming" season, so don't blow up here — the
    // caller throws if *every* listing comes back empty.
    console.warn(`[sagg] No .st-category-wrapper cards at ${listingUrl}`);
    return [];
  }

  const events: SaggEvent[] = [];

  cards.each((_, el) => {
    const link = $(el).find("h2.post-title a").first();
    const title = link.text().replace(/\s+/g, " ").trim();
    const href = link.attr("href");
    if (!title || !href) {
      console.warn(`[sagg] Card without title/link at ${listingUrl}`);
      return;
    }

    let permalink: URL;
    try {
      permalink = new URL(href, ORIGIN);
    } catch {
      console.warn(`[sagg] Unparseable href ${JSON.stringify(href)} for "${title}"`);
      return;
    }
    // Cards are event permalinks; anything else is theme furniture.
    if (!permalink.pathname.startsWith("/event/")) return;
    // source_url is the dedup key, so keep it canonical — a tracking param
    // would otherwise re-insert a show we already have.
    permalink.search = "";
    permalink.hash = "";

    const excerpt = $(el).find(".post-excerpt p").first().text().replace(/\s+/g, " ").trim();
    const split = excerpt.match(DATE_VENUE_RE);
    if (!split) {
      console.warn(`[sagg] No "date, venue" line for "${title}" — excerpt: ${JSON.stringify(excerpt)}`);
      return;
    }

    const dates = parseSaggDateRange(split[1]);
    if (!dates) {
      console.warn(`[sagg] Unparseable date range ${JSON.stringify(split[1])} for "${title}"`);
      return;
    }

    const rawVenue = split[2].trim();
    events.push({
      url: permalink.toString(),
      title,
      venue: UNKNOWN_VENUE.test(rawVenue) ? VENUE_FALLBACK : rawVenue,
      start: dates.start,
      end: dates.end,
    });
  });

  if (events.length === 0) {
    throw new Error(
      `[sagg] Found ${cards.length} cards at ${listingUrl} but parsed 0 events — markup changed`
    );
  }

  console.log(`[sagg] ${listingUrl} — ${events.length}/${cards.length} cards parsed`);
  return events;
}

async function fetchListing(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`[sagg] ${url} returned ${response.status}`);
  }
  return response.text();
}

/**
 * Fetch + parse both listings, deduplicated and with finished shows dropped.
 * Split out from scrapeSagg so scripts/_probe-sagg.ts can exercise the exact
 * same code path without touching the database.
 */
export async function collectSaggEvents(): Promise<SaggEvent[]> {
  // The daily cron fires at 03:00 SGT, which is still the previous day in UTC —
  // so a UTC "today" would keep shows that closed yesterday. Same en-CA trick
  // lib/email.ts uses to get an SGT YYYY-MM-DD.
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

  // The two listings are disjoint today, but they're both driven by dates, so a
  // show opening tomorrow could appear on either side of midnight.
  const byUrl = new Map<string, SaggEvent>();
  let parsedTotal = 0;

  for (const listingUrl of LISTING_URLS) {
    const parsed = parseListing(await fetchListing(listingUrl), listingUrl);
    parsedTotal += parsed.length;
    for (const event of parsed) {
      if (!byUrl.has(event.url)) byUrl.set(event.url, event);
    }
  }

  // parseListing already throws if a page has cards but yields nothing, so
  // getting here empty means every listing came back with no cards at all.
  if (parsedTotal === 0) {
    throw new Error(`[sagg] All ${LISTING_URLS.length} listings returned 0 cards — site or markup changed`);
  }

  // Multi-month runs stay in as long as they're still open; the display-time
  // ongoing cap in lib/select-events.ts stops them squatting on the lineup.
  const live: SaggEvent[] = [];
  let expired = 0;
  let permanent = 0;
  let online = 0;
  for (const event of byUrl.values()) {
    const end = event.end ?? event.start;
    if (end < todayIso) {
      expired++;
      continue;
    }
    if (ONLINE_ONLY.test(event.title)) {
      console.log(`[sagg] Skipping online-only: ${event.title}`);
      online++;
      continue;
    }
    const runDays = Math.round((Date.parse(end) - Date.parse(event.start)) / 86_400_000);
    if (runDays > MAX_RUN_DAYS) {
      console.log(`[sagg] Skipping permanent display (${runDays}d): ${event.title}`);
      permanent++;
      continue;
    }
    live.push(event);
  }
  console.log(
    `[sagg] ${byUrl.size} listed — skipped ${expired} finished, ${permanent} permanent, ${online} online-only`
  );

  return live.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

export async function scrapeSagg(): Promise<number> {
  await initializeDb();

  const events = await collectSaggEvents();
  let newEvents = 0;

  for (const event of events) {
    // Cards carry no description at all; lib/enrich.ts picks up the detail
    // page's og:description during LLM processing.
    const result = await upsertEvent({
      source: "sagg",
      source_url: event.url,
      raw_title: event.title,
      raw_description: null,
      venue: event.venue,
      event_date_start: event.start,
      event_date_end: event.end,
    });

    if (result.inserted) newEvents++;
  }

  console.log(`[sagg] Found ${events.length} live shows, scraped ${newEvents} new events`);
  return newEvents;
}
