import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

/**
 * SportPlus.sg runs the Wix Events app. Rather than scraping whatever the page
 * happens to server-render into `wix-warmup-data` (which only ever exposed the
 * handful of events a single widget was configured to show), we lift the signed
 * Wix app `instance` token out of that blob and query the Wix Events v3 API
 * directly. That returns the site's full event catalogue with ISO timestamps,
 * an explicit timezone, and a country code we can geo-filter on.
 */

const WIX_EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";
const EVENTS_API_URL = "https://www.wixapis.com/events/v3/events/query";
const USER_AGENT = "SGEventsCuration/1.0";
const FALLBACK_TIMEZONE = "Asia/Singapore";
const PAGE_SIZE = 100;
const MAX_EVENTS = 500;

/**
 * Pages that embed a Wix Events widget, and therefore carry an `instance` token.
 * Tried in order so a single page being redesigned doesn't kill the scraper.
 */
const TOKEN_PAGE_URLS = [
  "https://www.sportplus.sg/singapore-sports-events",
  "https://www.sportplus.sg/singapore-running-events",
  "https://www.sportplus.sg/",
];

interface WixV3Event {
  title?: string;
  slug?: string;
  status?: string;
  shortDescription?: string;
  detailedDescription?: string;
  location?: {
    name?: string;
    address?: {
      country?: string;
      formattedAddress?: string;
    };
  };
  dateAndTimeSettings?: {
    dateAndTimeTbd?: boolean;
    startDate?: string;
    endDate?: string;
    timeZoneId?: string;
  };
  eventPageUrl?: {
    base?: string;
    path?: string;
  };
}

interface WixV3QueryResponse {
  events?: WixV3Event[];
  pagingMetadata?: {
    count?: number;
    offset?: number;
    total?: number;
  };
}

export interface ParsedSportPlusEvent {
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
}

/** Convert an ISO-8601 UTC instant to a `YYYY-MM-DD` date in the event's own timezone. */
function toLocalDate(iso: string | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone });
  } catch {
    // Unknown/garbage IANA id — fall back rather than dropping the event.
    formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: FALLBACK_TIMEZONE });
  }

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/**
 * SportPlus lists overseas races (Bali, Sydney, KL, Bangkok...) alongside local
 * ones. jio only shows events happening in Singapore, so drop the rest here.
 */
function isInSingapore(evt: WixV3Event): boolean {
  const country = evt.location?.address?.country?.trim().toUpperCase();
  if (country) return country === "SG";
  const haystack = `${evt.location?.name ?? ""} ${evt.location?.address?.formattedAddress ?? ""}`;
  return haystack.toLowerCase().includes("singapore");
}

/** Pull the signed Wix app instance token out of a page's `wix-warmup-data` blob. */
function extractInstanceToken(html: string): string | null {
  const $ = cheerio.load(html);
  const raw = $("script#wix-warmup-data").html();
  if (!raw) return null;

  let warmup: Record<string, unknown>;
  try {
    warmup = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const apps = warmup.appsWarmupData as Record<string, Record<string, unknown>> | undefined;
  const eventsApp = apps?.[WIX_EVENTS_APP_ID];
  if (!eventsApp) return null;

  for (const widget of Object.values(eventsApp)) {
    const instance = (widget as Record<string, unknown> | undefined)?.instance;
    if (typeof instance === "string" && instance.length > 0) return instance;
    if (instance && typeof instance === "object") {
      const nested = (instance as { instance?: unknown }).instance;
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
  }
  return null;
}

async function fetchInstanceToken(): Promise<string> {
  const failures: string[] = [];

  for (const url of TOKEN_PAGE_URLS) {
    let html: string;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        failures.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      failures.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const token = extractInstanceToken(html);
    if (token) return token;
    failures.push(`${url} -> no Wix Events instance token in wix-warmup-data`);
  }

  throw new Error(
    `[sportplus] Could not obtain a Wix Events instance token. Attempts: ${failures.join("; ")}`
  );
}

/** Query the Wix Events v3 API for every upcoming event, following pagination. */
async function fetchUpcomingWixEvents(instance: string): Promise<WixV3Event[]> {
  const collected: WixV3Event[] = [];
  let offset = 0;

  for (;;) {
    const res = await fetch(EVENTS_API_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Authorization: instance,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          filter: { status: "UPCOMING" },
          sort: [{ fieldName: "dateAndTimeSettings.startDate", order: "ASC" }],
          paging: { limit: PAGE_SIZE, offset },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `[sportplus] Wix Events API returned ${res.status} at offset ${offset}: ${body.slice(0, 200)}`
      );
    }

    const data = (await res.json()) as WixV3QueryResponse;
    // A missing envelope means the API contract changed — fail loudly.
    if (!Array.isArray(data.events) || !data.pagingMetadata) {
      throw new Error(
        `[sportplus] Unexpected Wix Events API response shape (keys: ${Object.keys(data ?? {}).join(",") || "none"})`
      );
    }

    collected.push(...data.events);

    const total = data.pagingMetadata.total ?? collected.length;
    const count = data.pagingMetadata.count ?? data.events.length;
    offset += count;

    if (count === 0 || collected.length >= total || collected.length >= MAX_EVENTS) break;
  }

  return collected;
}

/**
 * Fetch + parse only. Exported so the probe script can verify parsing without
 * writing to the database, and so both paths share identical logic.
 */
export async function fetchSportPlusEvents(): Promise<{
  parsed: ParsedSportPlusEvent[];
  rawCount: number;
  skippedOverseas: number;
  skippedUnparsable: number;
}> {
  const instance = await fetchInstanceToken();
  const wixEvents = await fetchUpcomingWixEvents(instance);

  const parsed: ParsedSportPlusEvent[] = [];
  let skippedOverseas = 0;
  let skippedUnparsable = 0;

  for (const evt of wixEvents) {
    const title = evt.title?.trim();
    if (!title) {
      skippedUnparsable++;
      continue;
    }

    // Date not yet announced — nothing useful to put on a calendar.
    if (evt.dateAndTimeSettings?.dateAndTimeTbd) {
      skippedUnparsable++;
      continue;
    }

    const timeZone = evt.dateAndTimeSettings?.timeZoneId || FALLBACK_TIMEZONE;
    const startDate = toLocalDate(evt.dateAndTimeSettings?.startDate, timeZone);
    if (!startDate) {
      console.warn(
        `[sportplus] Unparsable start date for "${title}": ${evt.dateAndTimeSettings?.startDate}`
      );
      skippedUnparsable++;
      continue;
    }

    if (!isInSingapore(evt)) {
      skippedOverseas++;
      continue;
    }

    const endDateRaw = toLocalDate(evt.dateAndTimeSettings?.endDate, timeZone);
    const endDate = endDateRaw && endDateRaw !== startDate ? endDateRaw : null;

    const base = evt.eventPageUrl?.base ?? "https://www.sportplus.sg";
    const path = evt.eventPageUrl?.path ?? (evt.slug ? `/event-details/${evt.slug}` : null);
    if (!path) {
      console.warn(`[sportplus] No event page URL for "${title}"`);
      skippedUnparsable++;
      continue;
    }

    const description = evt.shortDescription?.trim() || evt.detailedDescription?.trim() || null;
    const venue =
      evt.location?.name?.trim() || evt.location?.address?.formattedAddress?.trim() || "Singapore";

    parsed.push({
      source_url: `${base}${path}`,
      raw_title: title,
      raw_description: description,
      venue,
      event_date_start: startDate,
      event_date_end: endDate,
    });
  }

  // The API answered, but nothing in it was usable — that is a structural break,
  // not a quiet week. Fail loudly so the pipeline alert fires.
  if (wixEvents.length > 0 && parsed.length === 0 && skippedOverseas === 0) {
    throw new Error(
      `[sportplus] Wix Events API returned ${wixEvents.length} upcoming events but none could be parsed`
    );
  }

  return {
    parsed,
    rawCount: wixEvents.length,
    skippedOverseas,
    skippedUnparsable,
  };
}

export async function scrapeSportPlus(): Promise<number> {
  await initializeDb();

  const { parsed, rawCount, skippedOverseas, skippedUnparsable } = await fetchSportPlusEvents();

  if (rawCount === 0) {
    console.log("[sportplus] Wix Events API reports no upcoming events");
    return 0;
  }

  console.log(
    `[sportplus] ${rawCount} upcoming events from API — ${parsed.length} in Singapore, ` +
      `${skippedOverseas} overseas, ${skippedUnparsable} unparsable`
  );

  let newEvents = 0;
  for (const event of parsed) {
    const result = await upsertEvent({ source: "sportplus", ...event });
    if (result.inserted) newEvents++;
  }

  console.log(`[sportplus] Scraped ${newEvents} new events`);
  return newEvents;
}
