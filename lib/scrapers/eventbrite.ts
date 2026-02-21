import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

const SEARCH_URLS = [
  "https://www.eventbrite.sg/d/singapore--singapore/events--this-week/",
  "https://www.eventbrite.sg/d/singapore--singapore/events--next-week/",
];
const MAX_PAGES = 5;
const USER_AGENT = "SGEventsCuration/1.0";

interface EventbriteEvent {
  name: string;
  summary: string | null;
  url: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  primary_venue: { name: string } | null;
  is_online_event: boolean;
  is_cancelled: boolean;
}

interface EventbriteServerData {
  search_data?: {
    events?: {
      results?: EventbriteEvent[];
      pagination?: {
        page_number: number;
        page_count: number;
      };
    };
  };
}

function extractServerData(html: string): EventbriteServerData | null {
  const $ = cheerio.load(html);
  let serverData: EventbriteServerData | null = null;

  $("script").each((_, el) => {
    if (serverData) return;
    const text = $(el).html();
    if (!text) return;

    const marker = "window.__SERVER_DATA__ = ";
    const idx = text.indexOf(marker);
    if (idx === -1) return;

    // The assignment is: window.__SERVER_DATA__ = {...};\n
    // Find the terminating semicolon-newline that ends the JS statement
    const jsonStart = idx + marker.length;
    const rest = text.slice(jsonStart);
    const semiNewline = rest.search(/;\s*\n/);
    const raw = semiNewline !== -1 ? rest.slice(0, semiNewline) : rest.trimEnd().replace(/;$/, "");

    try {
      serverData = JSON.parse(raw);
    } catch {
      console.warn("[eventbrite] Failed to parse __SERVER_DATA__ JSON");
    }
  });

  return serverData;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

export async function scrapeEventbrite(): Promise<number> {
  initializeDb();
  let newEvents = 0;
  const seenUrls = new Set<string>();

  for (const baseUrl of SEARCH_URLS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;

      let html: string;
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
        });
        if (!response.ok) {
          console.warn(`[eventbrite] ${url} returned ${response.status}, stopping pagination`);
          break;
        }
        html = await response.text();
      } catch (err) {
        console.warn(`[eventbrite] Fetch failed for ${url}:`, err);
        break;
      }

      const data = extractServerData(html);
      const events = data?.search_data?.events?.results;
      const pagination = data?.search_data?.events?.pagination;

      if (!events || events.length === 0) {
        break;
      }

      for (const event of events) {
        if (event.is_online_event) continue;
        if (event.is_cancelled) continue;
        if (!event.primary_venue?.name) continue;
        if (!event.name || !event.url) continue;

        const normalizedUrl = normalizeUrl(event.url);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        const endDate =
          event.end_date && event.end_date !== event.start_date
            ? event.end_date
            : null;

        const result = upsertEvent({
          source: "eventbrite",
          source_url: normalizedUrl,
          raw_title: event.name,
          raw_description: event.summary || null,
          venue: event.primary_venue.name,
          event_date_start: event.start_date,
          event_date_end: endDate,
        });

        if (result.inserted) {
          newEvents++;
        }
      }

      // Stop if we've reached the last page
      if (pagination && pagination.page_number >= pagination.page_count) {
        break;
      }
    }
  }

  console.log(`[eventbrite] Scraped ${newEvents} new events`);
  return newEvents;
}
