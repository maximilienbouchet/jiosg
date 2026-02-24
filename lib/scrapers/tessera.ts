import { initializeDb, checkEventExists, upsertEvent } from "../db";

const LISTING_URL = "https://api.yourtessera.com/v2/mp/events?city=singapore";
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;
const MAX_PAGES = 20;

const EXCLUDED_CATEGORIES = new Set(["health-wellness", "business-professional"]);

interface TesseraEvent {
  slug: string;
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  venue?: string | { name?: string };
  category?: string;
  categorySlug?: string;
  categories?: string[];
}

interface TesseraListingResponse {
  data: TesseraEvent[];
  next_cursor?: string | null;
  has_more?: boolean;
  meta?: { nextCursor?: string | null };
}

interface TesseraDetailResponse {
  description?: string;
  venue?: string | { name?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateString(dt: string | null): string | null {
  if (!dt) return null;
  const match = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function hasExcludedCategory(event: TesseraEvent): boolean {
  if (event.category && EXCLUDED_CATEGORIES.has(event.category)) return true;
  if (event.categorySlug && EXCLUDED_CATEGORIES.has(event.categorySlug)) return true;
  if (event.categories) {
    return event.categories.some((c) => EXCLUDED_CATEGORIES.has(c));
  }
  return false;
}

export async function scrapeTessera(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  // Fetch all pages
  const allEvents: TesseraEvent[] = [];
  let url: string | null = LISTING_URL;
  let pageCount = 0;

  while (url && pageCount < MAX_PAGES) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          "Origin": "https://www.yourtessera.com",
          "Accept": "application/json",
        },
      });
      if (!response.ok) {
        console.warn(`[tessera] Listing returned ${response.status}, stopping`);
        break;
      }
      const data: TesseraListingResponse = await response.json();
      const events = data.data || [];
      allEvents.push(...events);

      const nextCursor = data.next_cursor || data.meta?.nextCursor;
      if (nextCursor && data.has_more !== false) {
        url = `${LISTING_URL}&cursor=${nextCursor}`;
      } else {
        url = null;
      }
      pageCount++;
    } catch (err) {
      console.warn("[tessera] Fetch failed:", err);
      break;
    }
  }

  console.log(`[tessera] Found ${allEvents.length} events across ${pageCount} pages`);

  for (const event of allEvents) {
    // Pre-filter: skip excluded categories
    if (hasExcludedCategory(event)) continue;

    const sourceUrl = `https://www.yourtessera.com/e/${event.slug}`;
    const startDate = toDateString(event.start_date || event.startDate || null);
    if (!startDate) continue;

    // Skip if already in DB
    if (await checkEventExists(sourceUrl)) continue;

    // Fetch detail for description
    let description: string | null = null;
    let venue = (typeof event.venue === "string" ? event.venue : event.venue?.name) || "Singapore";
    try {
      await sleep(DETAIL_DELAY_MS);
      const detailRes = await fetch(`https://api.yourtessera.com/mp/events/slug/${event.slug}`, {
        headers: {
          "User-Agent": USER_AGENT,
          "Origin": "https://www.yourtessera.com",
          "Accept": "application/json",
        },
      });
      if (detailRes.ok) {
        const detail: TesseraDetailResponse = await detailRes.json();
        description = detail.description || null;
        // Strip HTML tags from description
        if (description) {
          description = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
        const detailVenue = typeof detail.venue === "string" ? detail.venue : detail.venue?.name;
        if (detailVenue) {
          venue = detailVenue;
        }
      }
    } catch (err) {
      console.warn(`[tessera] Failed to fetch detail for ${event.slug}:`, err);
    }

    const endDate = toDateString(event.end_date || event.endDate || null);

    const result = await upsertEvent({
      source: "tessera",
      source_url: sourceUrl,
      raw_title: event.title,
      raw_description: description,
      venue,
      event_date_start: startDate,
      event_date_end: endDate && endDate !== startDate ? endDate : null,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[tessera] Scraped ${newEvents} new events`);
  return newEvents;
}
