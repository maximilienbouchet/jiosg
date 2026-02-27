import { initializeDb, checkEventExists, upsertEvent } from "../db";

const SEARCH_URL = "https://peatix.com/search/events?country=SG&l.ll=1.3343,103.8724&p=1&size=300";
const USER_AGENT = "Mozilla/5.0 (compatible; SGEventsCuration/1.0)";
const DETAIL_DELAY_MS = 1000; // Respect robots.txt Crawl-delay: 1
const MAX_RETRIES = 2;

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json",
};

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateString(dt: string | null): string | null {
  if (!dt) return null;
  // Peatix returns datetime strings like "2026-03-01 09:00:00 +0800"
  const match = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

async function fetchJson(url: string, extraHeaders?: Record<string, string>): Promise<unknown> {
  const headers = { ...COMMON_HEADERS, ...extraHeaders };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[peatix] Retry ${attempt}/${MAX_RETRIES} for ${url}`);
      await sleep(2000 * attempt);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const text = await response.text();
    if (!text || text.length === 0) {
      lastError = new Error(`Empty response body from ${url} (status ${response.status})`);
      console.warn(`[peatix] ${lastError.message}, retrying...`);
      continue;
    }

    try {
      return JSON.parse(text);
    } catch {
      lastError = new Error(
        `Invalid JSON from ${url} (${text.length} bytes, starts with: ${JSON.stringify(text.slice(0, 120))})`
      );
      console.warn(`[peatix] ${lastError.message}, retrying...`);
      continue;
    }
  }

  throw lastError;
}

export async function scrapePeatix(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  let events: PeatixSearchEvent[];
  try {
    const data = await fetchJson(SEARCH_URL, {
      "X-Requested-With": "XMLHttpRequest",
    }) as Record<string, unknown>;
    const nested = (data.json_data || data) as Record<string, unknown>;
    events = (Array.isArray(nested) ? nested : (nested.events || nested.results || [])) as PeatixSearchEvent[];
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
      const detail = await fetchJson(`https://peatix.com/event/${event.id}/get_view_data`) as Record<string, unknown>;
      // Response wraps in json_data: { event: { description: "..." } }
      const eventData = (detail.json_data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      description = (eventData?.description as string) || null;
      // Strip HTML tags from description
      if (description) {
        description = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
