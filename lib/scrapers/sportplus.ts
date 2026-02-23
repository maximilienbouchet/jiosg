import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

const PAGE_URL = "https://www.sportplus.sg/singapore-sports-events";
const USER_AGENT = "SGEventsCuration/1.0";
const WIX_EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/** Parse Wix formatted date like "29 March 2026" → "2026-03-29" */
function parseWixDate(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthStr, year] = match;
  const month = MONTH_MAP[monthStr.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

interface WixEvent {
  title?: string;
  description?: string;
  slug?: string;
  status?: number;
  location?: { name?: string };
  scheduling?: {
    startDateFormatted?: string;
    endDateFormatted?: string;
  };
  registration?: {
    external?: { registration?: string };
  };
}

function extractEvents(html: string): WixEvent[] {
  const $ = cheerio.load(html);
  const scriptContent = $("script#wix-warmup-data").html();
  if (!scriptContent) {
    console.warn("[sportplus] No wix-warmup-data script tag found");
    return [];
  }

  let warmupData: Record<string, unknown>;
  try {
    warmupData = JSON.parse(scriptContent);
  } catch {
    console.warn("[sportplus] Failed to parse wix-warmup-data JSON");
    return [];
  }

  const appData = (warmupData as Record<string, Record<string, unknown>>).appsWarmupData?.[WIX_EVENTS_APP_ID] as Record<string, Record<string, unknown>> | undefined;
  if (!appData) {
    console.warn("[sportplus] No data found for Wix Events app ID");
    return [];
  }

  // Iterate widget keys to find the one containing events.events
  for (const widgetKey of Object.keys(appData)) {
    const widget = appData[widgetKey] as Record<string, unknown> | undefined;
    const eventsContainer = widget?.events as { events?: WixEvent[]; hasMore?: boolean } | undefined;
    if (eventsContainer?.events) {
      if (eventsContainer.hasMore) {
        console.warn("[sportplus] Warning: hasMore=true — some events may be missing");
      }
      return eventsContainer.events;
    }
  }

  console.warn("[sportplus] No events array found in any widget");
  return [];
}

export async function scrapeSportPlus(): Promise<number> {
  initializeDb();
  let newEvents = 0;

  let html: string;
  try {
    const response = await fetch(PAGE_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      console.warn(`[sportplus] Fetch returned ${response.status}`);
      return 0;
    }
    html = await response.text();
  } catch (err) {
    console.warn("[sportplus] Fetch failed:", err);
    return 0;
  }

  const events = extractEvents(html);
  if (events.length === 0) {
    console.warn("[sportplus] No events extracted from page");
    return 0;
  }

  for (const event of events) {
    // Skip past/cancelled events (status 0 = upcoming)
    if (event.status !== 0) continue;

    const title = event.title?.trim();
    const venue = event.location?.name?.trim();
    if (!title || !venue) {
      console.warn(`[sportplus] Skipping event with missing title or venue: title="${title}", venue="${venue}"`);
      continue;
    }

    const startDate = parseWixDate(event.scheduling?.startDateFormatted ?? "");
    if (!startDate) {
      console.warn(`[sportplus] Could not parse start date for "${title}": "${event.scheduling?.startDateFormatted}"`);
      continue;
    }

    const endDateRaw = parseWixDate(event.scheduling?.endDateFormatted ?? "");
    const endDate = endDateRaw && endDateRaw !== startDate ? endDateRaw : null;

    const sourceUrl = event.slug
      ? `https://www.sportplus.sg/event-details/${event.slug}`
      : PAGE_URL;

    const result = upsertEvent({
      source: "sportplus",
      source_url: sourceUrl,
      raw_title: title,
      raw_description: event.description?.trim() || null,
      venue,
      event_date_start: startDate,
      event_date_end: endDate,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[sportplus] Scraped ${newEvents} new events`);
  return newEvents;
}
