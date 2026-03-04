import * as cheerio from "cheerio";
import { initializeDb, checkEventExists, upsertEvent } from "../db";

const BASE_URL = "https://www.scape.sg";
const LISTING_URL = `${BASE_URL}/whats-on/`;
const MAX_PAGES = 5;
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KNOWN_CATEGORIES = new Set([
  "media & entertainment",
  "creative arts",
  "entrepreneurship & careers",
  "community",
  "sports & wellness",
]);

function isCategory(text: string): boolean {
  return KNOWN_CATEGORIES.has(text.toLowerCase());
}

function parseDateText(text: string): { startDate: string | null; endDate: string | null } {
  if (!text) return { startDate: null, endDate: null };

  // Clean up: remove time portions like ", 7:30 pm" or ", 7:30PM - 10PM" or ", 12:00 am"
  const cleaned = text.replace(/,?\s*\d{1,2}:\d{2}\s*(?:am|pm)(?:\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm))?/gi, "").trim();

  // Range with full dates: "26 Feb - 31 Mar 2026"
  const fullRangeMatch = cleaned.match(/(\d{1,2})\s+(\w+)\s*-\s*(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (fullRangeMatch) {
    const [, startDay, startMonthStr, endDay, endMonthStr, year] = fullRangeMatch;
    const startMonth = MONTH_MAP[startMonthStr.toLowerCase()];
    const endMonth = MONTH_MAP[endMonthStr.toLowerCase()];
    if (startMonth && endMonth) {
      return {
        startDate: `${year}-${startMonth}-${startDay.padStart(2, "0")}`,
        endDate: `${year}-${endMonth}-${endDay.padStart(2, "0")}`,
      };
    }
  }

  // Range same month: "18 - 19 Apr 2026"
  const sameMonthRange = cleaned.match(/(\d{1,2})\s*-\s*(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (sameMonthRange) {
    const [, startDay, endDay, monthStr, year] = sameMonthRange;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      return {
        startDate: `${year}-${month}-${startDay.padStart(2, "0")}`,
        endDate: `${year}-${month}-${endDay.padStart(2, "0")}`,
      };
    }
  }

  // Single date: "7 Mar 2026"
  const singleMatch = cleaned.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (singleMatch) {
    const [, day, monthStr, year] = singleMatch;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      return { startDate: `${year}-${month}-${day.padStart(2, "0")}`, endDate: null };
    }
  }

  // Month-only range: "May - June 2026"
  const monthRange = cleaned.match(/(\w+)\s*-\s*(\w+)\s+(\d{4})/);
  if (monthRange) {
    const [, startMonthStr, endMonthStr, year] = monthRange;
    const startMonth = MONTH_MAP[startMonthStr.toLowerCase()];
    const endMonth = MONTH_MAP[endMonthStr.toLowerCase()];
    if (startMonth && endMonth) {
      return {
        startDate: `${year}-${startMonth}-01`,
        endDate: null,
      };
    }
  }

  // Single month: "March 2026"
  const singleMonth = cleaned.match(/(\w+)\s+(\d{4})/);
  if (singleMonth) {
    const [, monthStr, year] = singleMonth;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      return { startDate: `${year}-${month}-01`, endDate: null };
    }
  }

  return { startDate: null, endDate: null };
}

async function fetchDescription(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const $ = cheerio.load(html);

    // Try to get the main content area description
    // Remove script/style tags first
    $("script, style, nav, header, footer").remove();

    // Look for the main content — WordPress sites typically use .entry-content or similar
    const contentArea = $(".entry-content, .post-content, .wp-block-group, article").first();
    const text = contentArea.length > 0
      ? contentArea.text()
      : $("main").text() || $("body").text();

    const cleaned = text.replace(/\s+/g, " ").trim();
    // Cap at 2000 chars to avoid sending huge blobs to LLM
    return cleaned ? cleaned.slice(0, 2000) : null;
  } catch (err) {
    console.warn(`[scape] Failed to fetch detail for ${url}:`, err);
    return null;
  }
}

export async function scrapeScape(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? LISTING_URL : `${LISTING_URL}page/${page}/`;

    let html: string;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        console.warn(`[scape] Page ${page} returned ${response.status}, stopping pagination`);
        break;
      }
      html = await response.text();
    } catch (err) {
      if (page === 1) {
        console.error("[scape] Failed to fetch listing page:", err);
        throw err;
      }
      console.warn(`[scape] Fetch failed for page ${page}:`, err);
      break;
    }

    const $ = cheerio.load(html);

    // Find all event links — they're <a> tags inside <li> elements that link to /whats-on/
    const eventLinks = $('a[href*="/whats-on/"]').filter((_, el) => {
      const href = $(el).attr("href") || "";
      // Only detail pages (not the listing page itself or pagination)
      return href.startsWith("https://www.scape.sg/whats-on/") &&
        href !== "https://www.scape.sg/whats-on/" &&
        !href.includes("/page/") &&
        $(el).find("h3").length > 0;
    });

    if (eventLinks.length === 0) {
      break;
    }

    console.log(`[scape] Page ${page}: found ${eventLinks.length} events`);

    for (const link of eventLinks.toArray()) {
      const $link = $(link);
      const title = $link.find("h3").text().trim();
      const sourceUrl = $link.attr("href") || "";

      if (!title || !sourceUrl) continue;

      // Extract <p> tags — order varies: some have [category, date, time, venue], others [date, venue]
      // Identify each by content pattern rather than position
      const paragraphs = $link.find("p").toArray().map((p) => $(p).text().trim()).filter(Boolean);

      let dateText = "";
      let venueText = "*SCAPE";

      for (const p of paragraphs) {
        // Date paragraph: contains a 4-digit year
        if (/\b\d{4}\b/.test(p) && !dateText) {
          // Strip pipe-separated time if present (e.g. "6 Mar 2026 | 7:30PM - 10PM")
          dateText = p.replace(/\s*\|.*$/, "").trim();
        }
        // Venue: contains location-like text (not a category, not a bare time, not a date)
        else if (!(/^\d{1,2}:\d{2}/.test(p)) && !isCategory(p) && !/\b\d{4}\b/.test(p) && p.length > 1) {
          venueText = p;
        }
      }

      const { startDate, endDate } = parseDateText(dateText);
      if (!startDate) {
        console.warn(`[scape] Could not parse date for "${title}": "${dateText}"`);
        continue;
      }

      // Skip if already in DB
      if (await checkEventExists(sourceUrl)) continue;

      // Fetch detail page for description
      await sleep(DETAIL_DELAY_MS);
      const description = await fetchDescription(sourceUrl);

      const result = await upsertEvent({
        source: "scape",
        source_url: sourceUrl,
        raw_title: title,
        raw_description: description,
        venue: venueText,
        event_date_start: startDate,
        event_date_end: endDate && endDate !== startDate ? endDate : null,
      });

      if (result.inserted) {
        newEvents++;
      }
    }

    // Check for next page link
    const nextLink = $('a').filter((_, el) => $(el).text().trim() === "›").attr("href");
    if (!nextLink) {
      break;
    }
  }

  console.log(`[scape] Scraped ${newEvents} new events`);
  return newEvents;
}
