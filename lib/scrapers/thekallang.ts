import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { initializeDb, upsertEvent } from "../db";

const BASE_URL = "https://www.thekallang.com.sg";
const CALENDAR_URL = `${BASE_URL}/events`;
const MAX_PAGES = 10;
const USER_AGENT = "SGEventsCuration/1.0";

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

function parseSingleDate(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthStr, year] = match;
  const month = MONTH_MAP[monthStr.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function parseDateText(dateText: string): { startDate: string | null; endDate: string | null } {
  if (!dateText) return { startDate: null, endDate: null };

  // Range: "24 Jan 2026, Saturday - 15 Mar 2026, Sunday"
  if (dateText.includes(" - ")) {
    const [startPart, endPart] = dateText.split(" - ");
    return {
      startDate: parseSingleDate(startPart),
      endDate: parseSingleDate(endPart),
    };
  }

  // Multi-date: "14, 15, 18, 19, 20, 21, 22 Mar 2026, Wednesday, ..."
  // or with &: "27, 28 & 29 Mar 2026, Friday, Saturday & Sunday"
  const multiMatch = dateText.match(/^([\d,\s&]+)\s+(\w+)\s+(\d{4})/);
  if (multiMatch) {
    const [, daysStr, monthStr, year] = multiMatch;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      const days = daysStr.replace(/&/g, ",").split(",").map((d) => d.trim()).filter(Boolean);
      if (days.length > 1) {
        const firstDay = days[0].padStart(2, "0");
        const lastDay = days[days.length - 1].padStart(2, "0");
        return {
          startDate: `${year}-${month}-${firstDay}`,
          endDate: `${year}-${month}-${lastDay}`,
        };
      }
    }
  }

  // Single date: "22 Feb 2026, Sunday"
  return { startDate: parseSingleDate(dateText), endDate: null };
}

function parseCard($: cheerio.CheerioAPI, card: Element): {
  title: string;
  venue: string;
  dateText: string;
  description: string;
  sourceUrl: string;
} | null {
  const $card = $(card);

  const titleEl = $card.find(".event-card__title");
  const title = titleEl.text().trim();
  const href = titleEl.attr("href") || "";
  const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

  const venue = $card.find(".event-card__location").text().trim();
  const dateText = $card.find(".event-card__time").text().trim();
  const description = $card.find(".event-card__desc").text().trim();

  if (!title || !venue) {
    console.warn(`[thekallang] Skipping card with missing title or venue: title="${title}", venue="${venue}"`);
    return null;
  }

  return { title, venue, dateText, description, sourceUrl };
}

export async function scrapeTheKallang(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${CALENDAR_URL}?page=${page}`;

    let html: string;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        console.warn(`[thekallang] Page ${page} returned ${response.status}, stopping pagination`);
        break;
      }
      html = await response.text();
    } catch (err) {
      console.warn(`[thekallang] Fetch failed for page ${page}:`, err);
      break;
    }

    const $ = cheerio.load(html);
    const cards = $(".event-card.col-lg-4");

    if (cards.length === 0) {
      break;
    }

    for (const card of cards.toArray()) {
      const parsed = parseCard($, card);
      if (!parsed) continue;

      const { startDate, endDate } = parseDateText(parsed.dateText);
      if (!startDate) {
        console.warn(`[thekallang] Could not parse date for "${parsed.title}": "${parsed.dateText}"`);
        continue;
      }

      const result = await upsertEvent({
        source: "thekallang",
        source_url: parsed.sourceUrl,
        raw_title: parsed.title,
        raw_description: parsed.description || null,
        venue: parsed.venue,
        event_date_start: startDate,
        event_date_end: endDate,
      });

      if (result.inserted) {
        newEvents++;
      }
    }

    // Check if there's a next page — stop if next link href is empty
    const nextLink = $(".pagination__next a").attr("href");
    if (!nextLink) {
      break;
    }
  }

  console.log(`[thekallang] Scraped ${newEvents} new events`);
  return newEvents;
}
