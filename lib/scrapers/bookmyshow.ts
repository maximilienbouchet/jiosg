import * as cheerio from "cheerio";
import { initializeDb, checkEventExists, upsertEvent } from "../db";

const SITEMAP_URL = "https://bookmyshow.sg/sitemap.xml";
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;
const MAX_NEW_EVENTS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateString(dt: string | null | undefined): string | null {
  if (!dt) return null;
  const match = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

interface JsonLdEvent {
  "@type"?: string;
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?: {
    name?: string;
    address?: string | { streetAddress?: string };
  };
  eventAttendanceMode?: string;
}

export async function scrapeBookMyShow(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  // Step 1: Fetch sitemap
  let sitemapXml: string;
  try {
    const res = await fetch(SITEMAP_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Sitemap returned ${res.status}`);
    sitemapXml = await res.text();
  } catch (err) {
    console.error("[bookmyshow] Failed to fetch sitemap:", err);
    throw err;
  }

  // Step 2: Extract event URLs from sitemap
  const $ = cheerio.load(sitemapXml, { xmlMode: true });
  const urls: string[] = [];
  $("loc").each((_, el) => {
    const url = $(el).text().trim();
    // Only event pages — skip movies, passes, packages
    if (url.includes("/en/events/")) {
      urls.push(url);
    }
  });

  console.log(`[bookmyshow] Found ${urls.length} event URLs in sitemap`);

  // Step 3: Fetch each event page and extract JSON-LD
  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  for (const url of urls) {
    if (newEvents >= MAX_NEW_EVENTS) {
      console.log(`[bookmyshow] Reached max new events (${MAX_NEW_EVENTS}), stopping`);
      break;
    }

    // Skip if already in DB
    if (await checkEventExists(url)) continue;

    await sleep(DETAIL_DELAY_MS);

    let html: string;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        console.warn(`[bookmyshow] ${url} returned ${res.status}, skipping`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.warn(`[bookmyshow] Failed to fetch ${url}:`, err);
      continue;
    }

    // Parse JSON-LD blocks
    const page$ = cheerio.load(html);
    let eventData: JsonLdEvent | null = null;

    page$('script[type="application/ld+json"]').each((_, el) => {
      if (eventData) return; // already found
      try {
        const json = JSON.parse(page$(el).html() || "");
        // Could be a single object or array
        const candidates = Array.isArray(json) ? json : [json];
        for (const candidate of candidates) {
          if (candidate["@type"] === "Event") {
            eventData = candidate;
            return;
          }
        }
      } catch {
        // malformed JSON-LD — skip
      }
    });

    if (!eventData) continue;
    const evt = eventData as JsonLdEvent;

    // Skip online events
    if (evt.eventAttendanceMode && evt.eventAttendanceMode.includes("Online")) {
      continue;
    }

    const startDate = toDateString(evt.startDate);
    if (!startDate) continue;

    // Skip past events (more than 7 days ago)
    if (startDate < cutoffStr) continue;

    const endDateRaw = evt.endDate && evt.endDate.trim() !== "" ? evt.endDate : null;
    const endDate = toDateString(endDateRaw);

    const venue = evt.location?.name || "Singapore";
    const description = evt.description
      ? evt.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : null;

    const result = await upsertEvent({
      source: "bookmyshow",
      source_url: url,
      raw_title: evt.name || "Untitled Event",
      raw_description: description,
      venue,
      event_date_start: startDate,
      event_date_end: endDate && endDate !== startDate ? endDate : null,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[bookmyshow] Scraped ${newEvents} new events`);
  return newEvents;
}
