import { initializeDb, upsertEvent } from "../db";
import { addDays } from "../dates";

// Resident Advisor is the definitive listing for electronic music and club
// nights worldwide. jio had no nightlife coverage at all — none of the eleven
// existing sources list club programming — so RA fills that gap outright.
//
// We talk to ra.co's internal GraphQL endpoint rather than scraping HTML:
// the event pages themselves sit behind DataDome and return 403, but the
// GraphQL API is open (no auth, no cookies) and returns everything we need
// inline. That also means lib/enrich.ts can never top up a thin description
// for an ra.co URL, so we must store a complete one at scrape time — see
// buildDescription and MIN_DESCRIPTION_CHARS below.
const GRAPHQL_URL = "https://ra.co/graphql";
const SITE_ORIGIN = "https://ra.co";

// Verified via area(id:51) => country Singapore. This is the only reliable
// geo filter: 8 of 22 SG listings have an address that does not contain the
// word "Singapore" (or no address at all), so we cannot post-filter on it.
const SINGAPORE_AREA_ID = 51;

// The assessment verified 21 days; we take 60 because it is the same single
// request and RA is where touring DJs get announced weeks ahead — exactly the
// "heads up, book now" events jio wants. Beyond ~60 days listings are mostly
// TBA lineups that would get filtered on thin copy and never re-examined.
const LOOKAHEAD_DAYS = 60;

const PAGE_SIZE = 100;
// Singapore fits in one page (~35 listings over 120 days). The cap only exists
// so a totalResults blow-up cannot spin forever inside the Vercel budget.
const MAX_PAGES = 5;

// Curl-default or empty User-Agent gets a Cloudflare 403; any real browser UA
// passes. Keep this explicit rather than relying on the fetch default.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONTENT_CHARS = 1500;

// lib/llm.ts re-fetches the source URL whenever a description is under 100
// chars. On ra.co that fetch is guaranteed to 403, so anything short gets a
// factual tail appended instead. SOURCE_CONTEXT alone clears the threshold.
const MIN_DESCRIPTION_CHARS = 100;
const SOURCE_CONTEXT =
  "Event listing from Resident Advisor (ra.co), the international guide to electronic music, club nights and dance music events in Singapore.";

const EVENT_FIELDS = `
  id
  title
  date
  startTime
  endTime
  contentUrl
  content
  cost
  venue { name address }
  artists { name }
  genres { name }
  pick { blurb }
`;

interface RaVenue {
  name?: string | null;
  address?: string | null;
}

interface RaEvent {
  id?: string | null;
  title?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  contentUrl?: string | null;
  content?: string | null;
  cost?: string | null;
  venue?: RaVenue | null;
  artists?: ({ name?: string | null } | null)[] | null;
  genres?: ({ name?: string | null } | null)[] | null;
  pick?: { blurb?: string | null } | null;
}

interface RaGraphQlResponse {
  data?: {
    eventListings?: {
      totalResults?: number | null;
      data?: ({ event?: RaEvent | null } | null)[] | null;
    } | null;
  } | null;
  errors?: { message?: string }[];
}

export interface ParsedRaEvent {
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
}

/**
 * NFKC folds the stylized Unicode (mathematical bold/italic letters) that RA
 * promoters love into plain ASCII, so titles render on the site and the LLM
 * reads real words. Whitespace is flattened to match the other scrapers.
 */
function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** RA returns naive ISO datetimes ("2026-09-02T00:00:00.000"). */
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [iso, , month, day] = match;
  if (Number(month) < 1 || Number(month) > 12) return null;
  if (Number(day) < 1 || Number(day) > 31) return null;
  return iso;
}

function names(list: ({ name?: string | null } | null)[] | null | undefined): string[] {
  if (!list) return [];
  return list.map((item) => normalizeText(item?.name)).filter((name) => name.length > 0);
}

function buildDescription(event: RaEvent): string {
  const parts: string[] = [];

  const content = normalizeText(event.content).slice(0, MAX_CONTENT_CHARS);
  if (content) parts.push(content);

  // RA's own editorial pick blurb is the single best signal of quality on the
  // platform; surface it so the LLM filter and scorer both see it.
  const pick = normalizeText(event.pick?.blurb);
  if (pick) parts.push(`RA pick: ${pick}`);

  const artists = names(event.artists);
  if (artists.length > 0) parts.push(`Lineup: ${artists.join(", ")}.`);

  const genres = names(event.genres);
  if (genres.length > 0) parts.push(`Genres: ${genres.join(", ")}.`);

  const cost = normalizeText(event.cost);
  if (cost) parts.push(`Cost: ${cost}.`);

  const address = normalizeText(event.venue?.address);
  if (address) parts.push(`Address: ${address}.`);

  let description = parts.join(" ").trim();
  if (description.length < MIN_DESCRIPTION_CHARS) {
    description = `${description} ${SOURCE_CONTEXT}`.trim();
  }
  return description;
}

async function fetchPage(
  page: number,
  gte: string,
  lte: string
): Promise<{ totalResults: number; events: RaEvent[] }> {
  const body = JSON.stringify({
    query: `query($filters: FilterInputDtoInput) {
      eventListings(filters: $filters, pageSize: ${PAGE_SIZE}, page: ${page}) {
        totalResults
        data { event { ${EVENT_FIELDS} } }
      }
    }`,
    variables: {
      filters: {
        areas: { eq: SINGAPORE_AREA_ID },
        listingDate: { gte, lte },
      },
    },
  });

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // A 403 here means Cloudflare/DataDome started scoring us as a bot — the
    // most likely way this scraper dies. Fail loudly so scraper_runs alerts.
    throw new Error(`[ra] GraphQL page ${page} returned ${response.status} ${response.statusText}`);
  }

  let json: RaGraphQlResponse;
  try {
    json = (await response.json()) as RaGraphQlResponse;
  } catch (error) {
    throw new Error(`[ra] GraphQL page ${page} returned non-JSON body: ${String(error)}`);
  }

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message ?? "unknown").join("; ");
    throw new Error(`[ra] GraphQL errors on page ${page}: ${messages}`);
  }

  const listings = json.data?.eventListings;
  if (!listings) {
    throw new Error(`[ra] GraphQL page ${page} response missing data.eventListings — schema changed`);
  }

  const events = (listings.data ?? [])
    .map((row) => row?.event)
    .filter((event): event is RaEvent => Boolean(event));

  return { totalResults: Number(listings.totalResults ?? 0), events };
}

/**
 * Fetch + parse only — no database access, so scripts/_probe-ra.ts can verify
 * the mapping without touching Turso (the `ra` source is not in the schema
 * CHECK constraint yet).
 */
export async function fetchRaEvents(todaySgt: string): Promise<{
  events: ParsedRaEvent[];
  totalResults: number;
  pages: number;
  skipped: string[];
  pastFiltered: number;
}> {
  // Query from yesterday so a UTC-vs-SGT boundary can never drop tonight's
  // listings; anything before today is filtered out client-side below.
  const gte = `${addDays(todaySgt, -1)}T00:00:00.000Z`;
  const lte = `${addDays(todaySgt, LOOKAHEAD_DAYS)}T23:59:59.999Z`;

  const first = await fetchPage(1, gte, lte);
  const totalResults = first.totalResults;
  const raw: RaEvent[] = [...first.events];

  const pageCount = Math.min(Math.max(1, Math.ceil(totalResults / PAGE_SIZE)), MAX_PAGES);
  for (let page = 2; page <= pageCount; page++) {
    const next = await fetchPage(page, gte, lte);
    if (next.events.length === 0) break;
    raw.push(...next.events);
  }

  if (totalResults > 0 && raw.length === 0) {
    throw new Error(`[ra] totalResults=${totalResults} but 0 event objects parsed — schema changed`);
  }

  const skipped: string[] = [];
  let pastFiltered = 0;

  // A multi-day event is returned once per night of its run, all sharing one
  // contentUrl (Health 2.0 at MBS came back three times for Dec 2/3/4). Group
  // by URL so the run collapses into a single event with a real date span
  // instead of three colliding upserts.
  const groups = new Map<string, { event: RaEvent; dates: Set<string>; endDates: Set<string> }>();

  for (const event of raw) {
    const title = normalizeText(event.title);
    const contentUrl = event.contentUrl?.trim();

    if (!title || !contentUrl) {
      skipped.push(`missing title or contentUrl (id=${event.id ?? "?"}, title="${title}")`);
      continue;
    }

    const startDate = toIsoDate(event.date) ?? toIsoDate(event.startTime);
    if (!startDate) {
      skipped.push(`unparseable date "${event.date ?? ""}" for "${title}" (${contentUrl})`);
      continue;
    }

    if (startDate < todaySgt) {
      // Expected: we deliberately over-fetch by one day.
      pastFiltered++;
      continue;
    }

    const existing = groups.get(contentUrl);
    if (existing) {
      existing.dates.add(startDate);
      const endDate = toIsoDate(event.endTime);
      if (endDate) existing.endDates.add(endDate);
      // Keep whichever copy carries the richest description.
      if ((event.content ?? "").length > (existing.event.content ?? "").length) {
        existing.event = event;
      }
      continue;
    }

    const endDate = toIsoDate(event.endTime);
    groups.set(contentUrl, {
      event,
      dates: new Set([startDate]),
      endDates: new Set(endDate ? [endDate] : []),
    });
  }

  const events: ParsedRaEvent[] = [];

  for (const [contentUrl, group] of groups) {
    const dates = [...group.dates].sort();
    const start = dates[0];
    let end: string | null = dates[dates.length - 1];

    // Club nights end at 3am, i.e. endTime lands on start+1. That is one night
    // out, not a two-day event, so only trust endTime past that.
    const latestEndTime = [...group.endDates].sort().pop();
    if (latestEndTime && latestEndTime > addDays(start, 1) && latestEndTime > end) {
      end = latestEndTime;
    }
    if (end <= start) end = null;

    events.push({
      source_url: `${SITE_ORIGIN}${contentUrl}`,
      raw_title: normalizeText(group.event.title),
      raw_description: buildDescription(group.event) || null,
      venue: normalizeText(group.event.venue?.name) || "Singapore",
      event_date_start: start,
      event_date_end: end,
    });
  }

  events.sort((a, b) => a.event_date_start.localeCompare(b.event_date_start));

  return { events, totalResults, pages: pageCount, skipped, pastFiltered };
}

export async function scrapeRa(): Promise<number> {
  await initializeDb();

  const todaySgt = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const { events, totalResults, skipped, pastFiltered } = await fetchRaEvents(todaySgt);

  for (const reason of skipped) {
    console.warn(`[ra] Skipped: ${reason}`);
  }

  if (events.length === 0) {
    // Singapore always has club listings on RA. Zero upcoming events means the
    // area filter, the schema, or the bot check changed — never a quiet week.
    throw new Error(
      `[ra] Parsed 0 upcoming events from ${totalResults} listings — area filter or schema changed`
    );
  }

  let newEvents = 0;
  for (const event of events) {
    const result = await upsertEvent({
      source: "ra",
      source_url: event.source_url,
      raw_title: event.raw_title,
      raw_description: event.raw_description,
      venue: event.venue,
      event_date_start: event.event_date_start,
      event_date_end: event.event_date_end,
    });
    if (result.inserted) newEvents++;
  }

  console.log(
    `[ra] ${totalResults} listings → ${events.length} events ` +
      `(${skipped.length} skipped, ${pastFiltered} past), scraped ${newEvents} new events`
  );
  return newEvents;
}
