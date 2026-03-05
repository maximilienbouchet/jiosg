import * as cheerio from "cheerio";
import { initializeDb, checkEventExists, upsertEvent } from "../db";

const BASE_URL = "https://www.srt.com.sg";
const LISTING_URL = `${BASE_URL}/new`;
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

function parseDateText(text: string): { startDate: string | null; endDate: string | null } {
  if (!text) return { startDate: null, endDate: null };

  const cleaned = text.trim();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // "Now till 28 Mar 2026"
  const nowTillWithYear = cleaned.match(/^now\s+till\s+(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (nowTillWithYear) {
    const [, day, monthStr, year] = nowTillWithYear;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      return {
        startDate: todayStr,
        endDate: `${year}-${month}-${day.padStart(2, "0")}`,
      };
    }
  }

  // "Now till 28 Mar" (no year — infer current year, bump if past)
  const nowTillNoYear = cleaned.match(/^now\s+till\s+(\d{1,2})\s+(\w+)$/i);
  if (nowTillNoYear) {
    const [, day, monthStr] = nowTillNoYear;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      let year = today.getFullYear();
      const candidate = new Date(`${year}-${month}-${day.padStart(2, "0")}`);
      if (candidate < today) {
        year++;
      }
      return {
        startDate: todayStr,
        endDate: `${year}-${month}-${day.padStart(2, "0")}`,
      };
    }
  }

  // "From 13 May 2026"
  const fromMatch = cleaned.match(/^from\s+(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (fromMatch) {
    const [, day, monthStr, year] = fromMatch;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      return {
        startDate: `${year}-${month}-${day.padStart(2, "0")}`,
        endDate: null,
      };
    }
  }

  // "22 Apr - 9 May 2026" (range across months)
  const fullRange = cleaned.match(/(\d{1,2})\s+(\w+)\s*[-–]\s*(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (fullRange) {
    const [, startDay, startMonthStr, endDay, endMonthStr, year] = fullRange;
    const startMonth = MONTH_MAP[startMonthStr.toLowerCase()];
    const endMonth = MONTH_MAP[endMonthStr.toLowerCase()];
    if (startMonth && endMonth) {
      return {
        startDate: `${year}-${startMonth}-${startDay.padStart(2, "0")}`,
        endDate: `${year}-${endMonth}-${endDay.padStart(2, "0")}`,
      };
    }
  }

  // "22 - 30 Apr 2026" (range same month)
  const sameMonthRange = cleaned.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(\w+)\s+(\d{4})/);
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
  const singleDate = cleaned.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (singleDate) {
    const [, day, monthStr, year] = singleDate;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    if (month) {
      return { startDate: `${year}-${month}-${day.padStart(2, "0")}`, endDate: null };
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

    $("script, style, nav, header, footer").remove();

    const contentArea = $("main, article, .content, .show-content, .entry-content").first();
    const text = contentArea.length > 0
      ? contentArea.text()
      : $("body").text();

    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned ? cleaned.slice(0, 2000) : null;
  } catch (err) {
    console.warn(`[srt] Failed to fetch detail for ${url}:`, err);
    return null;
  }
}

export async function scrapeSrt(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  let html: string;
  try {
    const response = await fetch(LISTING_URL, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      console.error(`[srt] Listing page returned ${response.status}`);
      throw new Error(`SRT listing page returned ${response.status}`);
    }
    html = await response.text();
  } catch (err) {
    console.error("[srt] Failed to fetch listing page:", err);
    throw err;
  }

  const $ = cheerio.load(html);

  // Find show cards — each is an <a href="/show/{slug}/"> containing <h4> title and <p> with date | venue
  const showLinks = $('a[href^="/show/"]').filter((_, el) => {
    return $(el).find("h4").length > 0;
  });

  console.log(`[srt] Found ${showLinks.length} show cards`);

  for (const link of showLinks.toArray()) {
    const $link = $(link);
    const title = $link.find("h4").first().text().trim();
    const href = $link.attr("href") || "";

    if (!title || !href) continue;

    const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    // Extract date and venue from <p> text — format: "date | venue"
    const pText = $link.find("p").first().text().trim();
    let dateText = "";
    let venue = "KC Arts Centre";

    if (pText.includes("|")) {
      const parts = pText.split("|").map((s) => s.trim());
      dateText = parts[0];
      if (parts[1]) venue = parts[1];
    } else {
      dateText = pText;
    }

    const { startDate, endDate } = parseDateText(dateText);
    if (!startDate) {
      console.warn(`[srt] Could not parse date for "${title}": "${dateText}"`);
      continue;
    }

    if (await checkEventExists(sourceUrl)) continue;

    // Fetch detail page for description
    await sleep(DETAIL_DELAY_MS);
    const description = await fetchDescription(sourceUrl);

    const result = await upsertEvent({
      source: "srt",
      source_url: sourceUrl,
      raw_title: title,
      raw_description: description,
      venue,
      event_date_start: startDate,
      event_date_end: endDate && endDate !== startDate ? endDate : null,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[srt] Scraped ${newEvents} new events`);
  return newEvents;
}
