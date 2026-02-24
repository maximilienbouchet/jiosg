import { initializeDb, checkEventExists, upsertEvent } from "../db";

const SEARCH_URL = "https://peatix.com/search/events?country=SG&l.ll=1.3343,103.8724&p=1&size=300";
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 1000; // Respect robots.txt Crawl-delay: 1

interface PeatixSearchEvent {
  id: number;
  name: string;
  datetime: string | null;
  datetime_start?: string | null;
  datetime_end?: string | null;
  days?: number;
  venue_name: string | null;
  isOnline?: boolean;
  thumb_venue?: string;
}

interface PeatixDetailData {
  event?: {
    description?: string;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateString(dt: string | null): string | null {
  if (!dt) return null;
  // Peatix returns ISO datetime strings like "2026-03-01T19:00:00+08:00"
  const match = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export async function scrapePeatix(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  let events: PeatixSearchEvent[];
  try {
    const response = await fetch(SEARCH_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}`);
    }
    const data = await response.json();
    const nested = data.json_data || data;
    events = Array.isArray(nested) ? nested : (nested.events || nested.results || []);
  } catch (err) {
    console.error("[peatix] Failed to fetch search results:", err);
    throw err;
  }

  console.log(`[peatix] Found ${events.length} events in search results`);

  for (const event of events) {
    // Pre-filter: skip online events
    if (event.isOnline) continue;
    if (event.venue_name === "xxxonlineeventxxx") continue;
    if (event.thumb_venue?.toLowerCase() === "online event") continue;

    const sourceUrl = `https://peatix.com/event/${event.id}`;
    const startDate = toDateString(event.datetime_start || event.datetime || null);
    if (!startDate) continue;

    // Skip if already in DB
    if (await checkEventExists(sourceUrl)) continue;

    // Fetch detail for description
    let description: string | null = null;
    try {
      await sleep(DETAIL_DELAY_MS);
      const detailRes = await fetch(`https://peatix.com/event/${event.id}/get_view_data`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (detailRes.ok) {
        const detail: PeatixDetailData = await detailRes.json();
        description = detail.event?.description || null;
        // Strip HTML tags from description
        if (description) {
          description = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
      }
    } catch (err) {
      console.warn(`[peatix] Failed to fetch detail for event ${event.id}:`, err);
    }

    const endDate = toDateString(event.datetime_end || null);
    const venue = event.venue_name || "Singapore";

    const result = await upsertEvent({
      source: "peatix",
      source_url: sourceUrl,
      raw_title: event.name,
      raw_description: description,
      venue,
      event_date_start: startDate,
      event_date_end: endDate && endDate !== startDate ? endDate : null,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[peatix] Scraped ${newEvents} new events`);
  return newEvents;
}
