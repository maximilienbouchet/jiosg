import { initializeDb, checkEventExists, upsertEvent } from "../db";

const LISTING_URL = "https://api.yourtessera.com/v2/mp/events?city=singapore";
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;
// The API returns 6 events per page; the full Singapore catalogue is ~120.
// Keep headroom so growth does not silently truncate the tail (which is where
// the furthest-out — and often most notable — events live).
const MAX_PAGES = 60;

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
  const seenCursors = new Set<string>();

  while (url && pageCount < MAX_PAGES) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Origin": "https://www.yourtessera.com",
        "Accept": "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`[tessera] Listing returned ${response.status} on page ${pageCount + 1}`);
    }
    const data: TesseraListingResponse = await response.json();
    const events = data.data || [];
    allEvents.push(...events);
    pageCount++;

    const nextCursor = data.next_cursor || data.meta?.nextCursor;
    if (!nextCursor || data.has_more === false) {
      url = null;
      continue;
    }

    // The API echoes the same nextCursor when the pagination parameter is not
    // understood, which silently re-fetches page 1 forever. Bail loudly instead:
    // this exact failure hid ~90% of the catalogue behind a stuck first page.
    if (seenCursors.has(nextCursor)) {
      throw new Error(
        `[tessera] Pagination stuck — cursor repeated after page ${pageCount}. ` +
          `Check that the cursor query parameter name is still "nextCursor".`
      );
    }
    seenCursors.add(nextCursor);

    // NB: the parameter is nextCursor. Sending "cursor" is silently ignored.
    url = `${LISTING_URL}&nextCursor=${encodeURIComponent(nextCursor)}`;
  }

  const uniqueSlugs = new Set(allEvents.map((e) => e.slug)).size;
  console.log(`[tessera] Found ${uniqueSlugs} unique events across ${pageCount} pages`);

  if (allEvents.length === 0) {
    throw new Error("[tessera] Listing returned no events at all");
  }

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
