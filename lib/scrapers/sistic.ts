import * as cheerio from "cheerio";
import { addDays } from "../dates";
import { checkEventExists, initializeDb, upsertEvent } from "../db";

// SISTIC is Singapore's dominant ticketing agency — arena concerts, theatre
// seasons, orchestra, dance, comedy and one-off sport. It is the single biggest
// fix for jio's "no big-name shows, almost no sport" coverage gap.
//
// www.sistic.com.sg is client-rendered (only og:title exists server-side), so
// there is no HTML to scrape and lib/enrich.ts cannot fill descriptions in
// later. We read the same undocumented Drupal JSON API the site's own frontend
// calls, and store the real synopsis ourselves.
const LISTING_ENDPOINT = "https://cms.sistic.com.sg/sistic/docroot/api/events";
const DETAIL_ENDPOINT = "https://cms.sistic.com.sg/sistic/docroot/api/event-detail";
const EVENT_PAGE_BASE = "https://www.sistic.com.sg/events";

// Their JS ships this static token in an Authorization header. The API ignores
// it today, so we only send it if we ever get a 401/403 — that way a rotated
// token cannot break us pre-emptively.
const FALLBACK_AUTH_TOKEN = "8atcfuaxn359vr35foajoea3";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const PAGE_SIZE = 30; // API returns 422 for limit > 30
const MAX_PAGES = 15;
const WINDOW_DAYS = 90;
const REQUEST_TIMEOUT_MS = 15_000;

// The listing has no description field, so every new event costs one detail
// call (~0.27s including the delay). Cap the work per run: lib/scrapers/index.ts
// kills a scraper at 50s, and ON CONFLICT(source_url) means steady state is a
// handful a day. 80 measured at ~22s, so a ~190-event cold start takes 3 runs.
const MAX_DETAIL_FETCHES = 80;
const DETAIL_DELAY_MS = 150;
const DETAIL_BUDGET_MS = 35_000;

const MAX_DESCRIPTION_CHARS = 2000;

// A SISTIC listing that runs longer than this is not a dated event: it is a
// standing bar residency ("Live at Cool Cats", Dec 2025 → Sep 2026), an
// attraction ticket (Sentosa 4D AdventureLand) or a tour placeholder (a Foo
// Fighters Australia/NZ run listed to Jan 2028). Real seasons here top out
// around 45 days, so this only catches permanent inventory.
const MAX_RUN_DAYS = 120;

// venue_name.country in the detail payload. SISTIC also sells overseas events
// (e.g. a volleyball tournament at Huamark Indoor Stadium, Bangkok).
const SINGAPORE_COUNTRY_CODE = "15";

// ~25% of the catalogue is self-serve workshop / seminar / trade-show inventory
// that SPEC's filter rejects every single time. Dropping it here saves a detail
// fetch and an LLM call each. Everything judgement-based (kids' shows, museum
// tickets, jazz residencies) is left to the LLM.
const SKIPPED_GENRES = new Set([
  "course, training or workshop",
  "seminar/workshop",
  "mice",
]);

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface SisticListingEvent {
  id?: string;
  title?: string;
  alias?: string;
  start_date?: string;
  end_date?: string | null;
  event_date?: string | null;
  venue_name?: string | null;
  primary_genre?: string | null;
  currency?: string | null;
  min_price?: string | null;
  max_price?: string | null;
}

interface SisticListingResponse {
  first?: number;
  limit?: number;
  total_records?: number | string;
  data?: SisticListingEvent[];
}

interface SisticDetailResponse {
  title?: string;
  synopsis?: { language?: string; plain_description?: string | null }[];
  venue_name?: { name?: string | null; country?: string | null } | null;
}

export interface SisticDetail {
  description: string | null;
  venue: string | null;
  country: string | null;
}

export interface SisticCandidate {
  alias: string;
  sourceUrl: string;
  title: string;
  venue: string;
  start: string;
  end: string | null;
  genre: string;
  price: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "Wed, 19 Aug 2026" → "2026-08-19". Returns null if the shape changed. */
export function parseSisticDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31 || year < 2000 || year > 2100) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Several fields come back as real markup (titles are wrapped in <p> and split
 * by <br>), and the synopses are full of HTML entities and nbsp. Tags become
 * spaces first — dropping them outright turns "Care<br>by" into "Careby" —
 * then cheerio decodes the entities.
 */
function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = cheerio.load(`<div>${value.replace(/<[^>]*>/g, " ")}</div>`).text();
  // \s also covers the non-breaking spaces SISTIC synopses are full of.
  const normalised = text.replace(/\s+/g, " ").trim();
  return normalised.length > 0 ? normalised : null;
}

/**
 * The listing carries currency + min/max rather than a formatted price, and a
 * zero minimum is how SISTIC lists free admission — worth passing on, it is
 * what earns the "free lah" tag downstream.
 */
function formatPrice(row: SisticListingEvent): string | null {
  const currency = (row.currency ?? "S$").trim();
  const min = (row.min_price ?? "").trim();
  const max = (row.max_price ?? "").trim();

  if (!min && !max) return null;
  if (min && Number(min) === 0 && (!max || Number(max) === 0)) return "Free";
  if (min && max && min !== max) return `${currency}${min} - ${currency}${max}`;
  return `${currency}${min || max}`;
}

async function fetchSisticJson<T>(url: string, label: string): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };

  let response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    response = await fetch(url, {
      headers: { ...headers, Authorization: FALLBACK_AUTH_TOKEN },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  if (!response.ok) {
    throw new Error(`[sistic] ${label} returned ${response.status}`);
  }

  return (await response.json()) as T;
}

/**
 * Walks the paginated listing for a date window. The API matches events whose
 * start OR end falls inside the window, so long-running shows still surface.
 */
export async function fetchSisticListings(
  startDate: string,
  endDate: string
): Promise<SisticListingEvent[]> {
  const byAlias = new Map<string, SisticListingEvent>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url =
      `${LISTING_ENDPOINT}?client=1&first=${offset}&limit=${PAGE_SIZE}` +
      `&sort_type=date&sort_order=ASC&start_date=${startDate}&end_date=${endDate}`;

    const payload = await fetchSisticJson<SisticListingResponse>(url, `listing offset ${offset}`);
    const rows = Array.isArray(payload.data) ? payload.data : [];

    // SISTIC always has hundreds of events in a 90-day window. Zero means the
    // response shape or the params changed — fail loudly rather than silently
    // reporting a healthy run with no events.
    if (page === 0 && rows.length === 0) {
      throw new Error(
        `[sistic] Listing returned 0 events for ${startDate}..${endDate} ` +
          `(total_records=${payload.total_records}) — API shape or params changed`
      );
    }

    for (const row of rows) {
      if (row.alias) byAlias.set(row.alias, row);
    }

    const total = Number(payload.total_records) || 0;
    if (rows.length < PAGE_SIZE || offset + PAGE_SIZE >= total) break;
  }

  return [...byAlias.values()];
}

/**
 * Unknown aliases answer HTTP 200 with `{"data":[],"header":[]}`, so the
 * payload shape — not the status code — decides whether we got an event.
 */
export async function fetchSisticDetail(alias: string): Promise<SisticDetail | null> {
  const url = `${DETAIL_ENDPOINT}?client=1&code=${encodeURIComponent(alias)}`;
  const payload = await fetchSisticJson<SisticDetailResponse>(url, `detail ${alias}`);

  if (!payload || typeof payload !== "object") return null;
  if (!payload.synopsis && !payload.venue_name && !payload.title) return null;

  const synopsis = Array.isArray(payload.synopsis) ? payload.synopsis : [];
  const english =
    synopsis.find((entry) => (entry?.language ?? "").toUpperCase() === "ENGLISH") ?? synopsis[0];

  return {
    description: cleanText(english?.plain_description)?.slice(0, MAX_DESCRIPTION_CHARS) ?? null,
    venue: cleanText(payload.venue_name?.name),
    country: payload.venue_name?.country ?? null,
  };
}

/**
 * Listing rows → events worth processing. Drops workshop/MICE inventory, past
 * events, standing residencies and anything with an unparseable date.
 */
export function buildSisticCandidates(
  listings: SisticListingEvent[],
  today: string
): { candidates: SisticCandidate[]; skipped: Record<string, number> } {
  const candidates: SisticCandidate[] = [];
  const skipped = { genre: 0, past: 0, standing: 0, badDate: 0, incomplete: 0 };

  for (const row of listings) {
    const alias = row.alias?.trim();
    const title = cleanText(row.title);
    if (!alias || !title) {
      skipped.incomplete++;
      console.warn(`[sistic] Listing row missing alias or title (id=${row.id ?? "?"}) — skipping`);
      continue;
    }

    const genre = (row.primary_genre ?? "").trim().toLowerCase();
    if (SKIPPED_GENRES.has(genre)) {
      skipped.genre++;
      continue;
    }

    const start = parseSisticDate(row.start_date);
    if (!start) {
      skipped.badDate++;
      console.warn(
        `[sistic] Unparseable start_date ${JSON.stringify(row.start_date)} for "${title}" (${alias}) — skipping`
      );
      continue;
    }

    const parsedEnd = parseSisticDate(row.end_date);
    if (row.end_date && !parsedEnd) {
      console.warn(
        `[sistic] Unparseable end_date ${JSON.stringify(row.end_date)} for "${title}" (${alias}) — treating as single-day`
      );
    }
    const lastDay = parsedEnd && parsedEnd >= start ? parsedEnd : start;

    if (lastDay < today) {
      skipped.past++;
      continue;
    }

    const runDays = daysBetween(start, lastDay);
    if (runDays > MAX_RUN_DAYS) {
      skipped.standing++;
      console.log(`[sistic] Skipping ${runDays}-day standing listing "${title}" (${alias})`);
      continue;
    }

    candidates.push({
      alias,
      sourceUrl: `${EVENT_PAGE_BASE}/${alias}`,
      title,
      venue: cleanText(row.venue_name) ?? "Singapore",
      start,
      // Single-day events must store null, not a repeated start date.
      end: lastDay > start ? lastDay : null,
      genre: cleanText(row.primary_genre) ?? "",
      price: formatPrice(row),
    });
  }

  return { candidates, skipped };
}

/**
 * Genre and price are the only useful signals the synopsis does not carry —
 * price in particular drives the "free lah" tag downstream.
 */
export function buildSisticDescription(
  candidate: SisticCandidate,
  description: string | null
): string {
  const facts = [
    candidate.genre ? `Genre: ${candidate.genre}.` : null,
    candidate.price ? `Tickets: ${candidate.price}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (!description) {
    // Rare, but the site page is client-rendered so enrich.ts cannot rescue it
    // later. Ship the structured facts rather than a bare title.
    return facts || `${candidate.title} at ${candidate.venue}.`;
  }

  return facts ? `${description} — ${facts}`.slice(0, MAX_DESCRIPTION_CHARS + 120) : description;
}

/** Existence checks are read-only, so run them concurrently in small batches. */
async function findKnownUrls(urls: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  const batchSize = 10;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((url) => checkEventExists(url)));
    results.forEach((exists, index) => {
      if (exists) known.add(batch[index]);
    });
  }

  return known;
}

export async function scrapeSistic(): Promise<number> {
  await initializeDb();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const windowEnd = addDays(today, WINDOW_DAYS);

  const listings = await fetchSisticListings(today, windowEnd);
  const { candidates, skipped } = buildSisticCandidates(listings, today);

  console.log(
    `[sistic] Listing ${today}..${windowEnd}: ${listings.length} events, ${candidates.length} candidates ` +
      `(skipped ${skipped.genre} workshop/MICE, ${skipped.standing} standing, ${skipped.past} past, ` +
      `${skipped.badDate} bad date, ${skipped.incomplete} incomplete)`
  );

  if (listings.length > 0 && candidates.length === 0) {
    throw new Error(
      `[sistic] Parsed 0 usable events from ${listings.length} listing rows — payload shape changed`
    );
  }

  const known = await findKnownUrls(candidates.map((candidate) => candidate.sourceUrl));

  const deadline = Date.now() + DETAIL_BUDGET_MS;
  let newEvents = 0;
  let detailAttempts = 0;
  let detailFailures = 0;
  let deferred = 0;
  let nonSingapore = 0;
  let missingDescription = 0;

  // Candidates arrive date-ascending, so a capped run always takes the soonest
  // events first — exactly the ones the site is about to display.
  for (const candidate of candidates) {
    if (known.has(candidate.sourceUrl)) {
      // Refresh title/venue/dates for shows that get rescheduled. Passing a null
      // description is safe: upsertEvent COALESCEs and keeps the stored one.
      await upsertEvent({
        source: "sistic",
        source_url: candidate.sourceUrl,
        raw_title: candidate.title,
        raw_description: null,
        venue: candidate.venue,
        event_date_start: candidate.start,
        event_date_end: candidate.end,
      });
      continue;
    }

    if (detailAttempts >= MAX_DETAIL_FETCHES || Date.now() > deadline) {
      deferred++;
      continue;
    }

    await sleep(DETAIL_DELAY_MS);
    detailAttempts++;

    let detail: SisticDetail | null;
    try {
      detail = await fetchSisticDetail(candidate.alias);
    } catch (error) {
      detailFailures++;
      console.warn(`[sistic] Detail fetch failed for ${candidate.alias}:`, error);
      continue;
    }

    // No detail means no description, and the public page cannot supply one.
    // Skip the insert so the next run retries instead of handing the LLM a
    // title-only event it would reject permanently.
    if (!detail) {
      detailFailures++;
      console.warn(`[sistic] Detail payload empty for ${candidate.alias} — will retry next run`);
      continue;
    }

    if (detail.country && detail.country !== SINGAPORE_COUNTRY_CODE) {
      nonSingapore++;
      console.log(
        `[sistic] Skipping non-Singapore event "${candidate.title}" (country=${detail.country})`
      );
      continue;
    }

    if (!detail.description) missingDescription++;

    const result = await upsertEvent({
      source: "sistic",
      source_url: candidate.sourceUrl,
      raw_title: candidate.title,
      raw_description: buildSisticDescription(candidate, detail.description),
      // Listing venue, not detail venue: the two always agree, and the refresh
      // pass above only has the listing one — mixing them would flap the value.
      venue: candidate.venue,
      event_date_start: candidate.start,
      event_date_end: candidate.end,
    });

    if (result.inserted) newEvents++;
  }

  // A total detail blackout means the endpoint moved or started blocking us.
  // Without this the run would report "0 new events" and look healthy.
  if (detailAttempts > 0 && detailFailures === detailAttempts) {
    throw new Error(
      `[sistic] All ${detailAttempts} detail fetches failed — endpoint changed or blocked`
    );
  }

  if (deferred > 0) {
    console.log(
      `[sistic] Deferred ${deferred} new events to the next run (detail cap ${MAX_DETAIL_FETCHES})`
    );
  }
  if (nonSingapore > 0) console.log(`[sistic] Skipped ${nonSingapore} non-Singapore events`);
  if (missingDescription > 0) {
    console.warn(`[sistic] ${missingDescription} events had no synopsis — stored structured facts only`);
  }
  if (detailFailures > 0) {
    console.warn(`[sistic] ${detailFailures}/${detailAttempts} detail fetches failed`);
  }

  console.log(`[sistic] Scraped ${newEvents} new events`);
  return newEvents;
}
