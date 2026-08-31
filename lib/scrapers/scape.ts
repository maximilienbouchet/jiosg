import * as cheerio from "cheerio";
import { initializeDb, checkEventExists, upsertEvent } from "../db";
import { addDays } from "../dates";

const BASE_URL = "https://www.scape.sg";
const LISTING_URL = `${BASE_URL}/whats-on/`;
const MAX_PAGES = 15;
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;
const FETCH_TIMEOUT_MS = 15_000;
/** Fraction of cards with unparseable dates that signals a site format change. */
const DATE_FAILURE_RATIO = 0.2;

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export interface ScapeListingItem {
  title: string;
  sourceUrl: string;
  dateText: string;
  venue: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop time fragments ("7:30 pm", "| 6:45PM - 10PM") that sometimes share the date node. */
function stripTimes(text: string): string {
  return text
    .replace(/\|/g, " ")
    .replace(/\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,\-&]+|[\s,\-&]+$/g, "")
    .trim();
}

function monthNumber(raw: string): number | null {
  return MONTH_MAP[raw.toLowerCase().replace(/\.$/, "")] ?? null;
}

/**
 * *SCAPE frequently omits the year ("5, 12, 19, 26 Aug"). Pick the year that
 * puts the date closest to today, which handles the Dec/Jan rollover.
 */
function inferYear(month: number, day: number, today: string): number {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const baseYear = Number(today.slice(0, 4));
  let best = baseYear;
  let bestDiff = Infinity;
  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const ms = Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month)));
    const diff = Math.abs(ms - todayMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = year;
    }
  }
  return best;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const MONTH_PATTERN = "([A-Za-z]{3,9})\\.?";
const YEAR_PATTERN = "(?:\\s*(\\d{4}))?";

// "5, 12, 19, 26 Aug" / "22 & 23 Aug 2026" / "2, 9, 16, 23, 30 Sep 2026"
const DAY_LIST_RE = new RegExp(
  `^(\\d{1,2}(?:\\s*(?:,|&|and)\\s*\\d{1,2})+)\\s+${MONTH_PATTERN}${YEAR_PATTERN}$`,
  "i"
);
// "1 Jul 2026 - 31 Aug 2026" / "1 Jul - 31 Aug 2026"
const CROSS_MONTH_RANGE_RE = new RegExp(
  `^(\\d{1,2})\\s+${MONTH_PATTERN}${YEAR_PATTERN}\\s*-\\s*(\\d{1,2})\\s+${MONTH_PATTERN}${YEAR_PATTERN}$`,
  "i"
);
// "1 - 31 August 2026" / "4 - 6 Sept 2026"
const SAME_MONTH_RANGE_RE = new RegExp(
  `^(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+${MONTH_PATTERN}${YEAR_PATTERN}$`,
  "i"
);
// "5 Sep 2026" / "21 Sept 2026" / "29 Aug"
const SINGLE_DATE_RE = new RegExp(`^(\\d{1,2})\\s+${MONTH_PATTERN}${YEAR_PATTERN}$`, "i");
// "Aug 2026 - Mar 2027"
const MONTH_RANGE_RE = new RegExp(
  `^${MONTH_PATTERN}${YEAR_PATTERN}\\s*-\\s*${MONTH_PATTERN}${YEAR_PATTERN}$`,
  "i"
);
// "August 2026" / "Aug"
const SINGLE_MONTH_RE = new RegExp(`^${MONTH_PATTERN}${YEAR_PATTERN}$`, "i");

/**
 * Parse a *SCAPE date label into ISO dates.
 * Multi-occurrence labels ("5, 12, 19, 26 Aug") become a range spanning
 * first → last occurrence so the event reads as ongoing.
 */
export function parseScapeDate(
  rawText: string,
  today: string
): { startDate: string | null; endDate: string | null } {
  const text = stripTimes(normalizeText(rawText));
  if (!text) return { startDate: null, endDate: null };

  const empty = { startDate: null, endDate: null };

  const dayList = text.match(DAY_LIST_RE);
  if (dayList) {
    const [, daysRaw, monthRaw, yearRaw] = dayList;
    const month = monthNumber(monthRaw);
    if (!month) return empty;
    const days = daysRaw.split(/\s*(?:,|&|and)\s*/i).map(Number).filter((d) => d > 0);
    if (days.length === 0) return empty;
    const first = Math.min(...days);
    const last = Math.max(...days);
    const year = yearRaw ? Number(yearRaw) : inferYear(month, first, today);
    const startDate = toIso(year, month, first);
    const endDate = toIso(year, month, last);
    if (!startDate) return empty;
    return { startDate, endDate: endDate && endDate !== startDate ? endDate : null };
  }

  const crossMonth = text.match(CROSS_MONTH_RANGE_RE);
  if (crossMonth) {
    const [, startDayRaw, startMonthRaw, startYearRaw, endDayRaw, endMonthRaw, endYearRaw] = crossMonth;
    const startMonth = monthNumber(startMonthRaw);
    const endMonth = monthNumber(endMonthRaw);
    if (!startMonth || !endMonth) return empty;
    const startDay = Number(startDayRaw);
    const endDay = Number(endDayRaw);

    let startYear: number;
    let endYear: number;
    if (startYearRaw && endYearRaw) {
      startYear = Number(startYearRaw);
      endYear = Number(endYearRaw);
    } else if (endYearRaw) {
      endYear = Number(endYearRaw);
      startYear = endMonth < startMonth ? endYear - 1 : endYear;
    } else if (startYearRaw) {
      startYear = Number(startYearRaw);
      endYear = endMonth < startMonth ? startYear + 1 : startYear;
    } else {
      startYear = inferYear(startMonth, startDay, today);
      endYear = endMonth < startMonth ? startYear + 1 : startYear;
    }

    const startDate = toIso(startYear, startMonth, startDay);
    const endDate = toIso(endYear, endMonth, endDay);
    if (!startDate) return empty;
    return { startDate, endDate: endDate && endDate > startDate ? endDate : null };
  }

  const sameMonth = text.match(SAME_MONTH_RANGE_RE);
  if (sameMonth) {
    const [, startDayRaw, endDayRaw, monthRaw, yearRaw] = sameMonth;
    const month = monthNumber(monthRaw);
    if (!month) return empty;
    const startDay = Number(startDayRaw);
    const year = yearRaw ? Number(yearRaw) : inferYear(month, startDay, today);
    const startDate = toIso(year, month, startDay);
    const endDate = toIso(year, month, Number(endDayRaw));
    if (!startDate) return empty;
    return { startDate, endDate: endDate && endDate > startDate ? endDate : null };
  }

  const single = text.match(SINGLE_DATE_RE);
  if (single) {
    const [, dayRaw, monthRaw, yearRaw] = single;
    const month = monthNumber(monthRaw);
    if (!month) return empty;
    const day = Number(dayRaw);
    const year = yearRaw ? Number(yearRaw) : inferYear(month, day, today);
    const startDate = toIso(year, month, day);
    if (!startDate) return empty;
    return { startDate, endDate: null };
  }

  const monthRange = text.match(MONTH_RANGE_RE);
  if (monthRange) {
    const [, startMonthRaw, startYearRaw, endMonthRaw, endYearRaw] = monthRange;
    const startMonth = monthNumber(startMonthRaw);
    const endMonth = monthNumber(endMonthRaw);
    if (!startMonth || !endMonth) return empty;

    let startYear: number;
    let endYear: number;
    if (startYearRaw && endYearRaw) {
      startYear = Number(startYearRaw);
      endYear = Number(endYearRaw);
    } else if (endYearRaw) {
      endYear = Number(endYearRaw);
      startYear = endMonth < startMonth ? endYear - 1 : endYear;
    } else if (startYearRaw) {
      startYear = Number(startYearRaw);
      endYear = endMonth < startMonth ? startYear + 1 : startYear;
    } else {
      startYear = inferYear(startMonth, 1, today);
      endYear = endMonth < startMonth ? startYear + 1 : startYear;
    }

    const startDate = toIso(startYear, startMonth, 1);
    const endDate = toIso(endYear, endMonth, daysInMonth(endYear, endMonth));
    if (!startDate) return empty;
    return { startDate, endDate: endDate && endDate > startDate ? endDate : null };
  }

  const singleMonth = text.match(SINGLE_MONTH_RE);
  if (singleMonth) {
    const [, monthRaw, yearRaw] = singleMonth;
    const month = monthNumber(monthRaw);
    if (!month) return empty;
    const year = yearRaw ? Number(yearRaw) : inferYear(month, 1, today);
    const startDate = toIso(year, month, 1);
    const endDate = toIso(year, month, daysInMonth(year, month));
    if (!startDate) return empty;
    return { startDate, endDate };
  }

  return empty;
}

/**
 * Extract event cards and the "next page" link from a *SCAPE listing page.
 * Cards live in `a.event-item`; the megamenu/deal blocks use different classes
 * (`megamenu-event-item`, `mobile-event-item`, `deal-item`) and are ignored.
 */
export function parseScapeListingPage(html: string): {
  items: ScapeListingItem[];
  nextPageUrl: string | null;
} {
  const $ = cheerio.load(html);
  const items: ScapeListingItem[] = [];

  $("a.event-item").each((_, el) => {
    const $el = $(el);
    const sourceUrl = ($el.attr("href") || "").trim();
    if (!sourceUrl.startsWith(`${BASE_URL}/whats-on/`)) return;
    if (sourceUrl.includes("/whats-on/deals")) return;

    const title = normalizeText($el.find("h3").first().text());
    if (!title) return;

    items.push({
      title,
      sourceUrl,
      dateText: normalizeText($el.find(".event-item-date").first().text()),
      venue: normalizeText($el.find(".event-item-venue").first().text()) || "*SCAPE",
    });
  });

  const nextHref = $("a.next.page-numbers").first().attr("href");
  const nextPageUrl = nextHref ? new URL(nextHref, BASE_URL).toString() : null;

  return { items, nextPageUrl };
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number; html: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return { ok: false, status: response.status, html: "" };
  return { ok: true, status: response.status, html: await response.text() };
}

/** Detail pages carry both the description and a repeat of the date label. */
export function parseScapeDetail(html: string): { dateText: string; description: string | null } {
  const $ = cheerio.load(html);
  const dateText = normalizeText($(".event-content-date").first().text());

  $("script, style, nav, header, footer").remove();
  const container = $(".article-content, .event-description-wrapper").first();
  const text = container.length > 0 ? container.text() : $("main").text();
  const description = normalizeText(text).slice(0, 2000);

  return { dateText, description: description || null };
}

async function fetchDetail(url: string): Promise<{ dateText: string; description: string | null } | null> {
  try {
    const { ok, status, html } = await fetchHtml(url);
    if (!ok) {
      console.warn(`[scape] Detail page ${url} returned ${status}`);
      return null;
    }
    return parseScapeDetail(html);
  } catch (err) {
    console.warn(`[scape] Failed to fetch detail for ${url}:`, err);
    return null;
  }
}

interface ParsedScapeEvent extends ScapeListingItem {
  startDate: string;
  endDate: string | null;
}

export async function scrapeScape(): Promise<number> {
  await initializeDb();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const cutoff = addDays(today, -7);

  // --- Phase 1: crawl + parse everything before touching the DB, so a site
  // format change fails loudly instead of writing garbage. ---
  const parsed: ParsedScapeEvent[] = [];
  const dateFailures: string[] = [];
  const visited = new Set<string>();
  let totalCards = 0;
  let pageUrl: string | null = LISTING_URL;
  let page = 0;

  while (pageUrl && page < MAX_PAGES) {
    if (visited.has(pageUrl)) break;
    visited.add(pageUrl);
    page++;

    const { ok, status, html } = await fetchHtml(pageUrl);
    if (!ok) {
      throw new Error(`[scape] Listing page ${page} (${pageUrl}) returned HTTP ${status}`);
    }

    const { items, nextPageUrl } = parseScapeListingPage(html);
    if (items.length === 0) {
      throw new Error(
        `[scape] Listing page ${page} (${pageUrl}) yielded 0 event cards \u2014 markup likely changed`
      );
    }

    console.log(`[scape] Page ${page}: found ${items.length} event cards`);
    totalCards += items.length;

    for (const item of items) {
      let { startDate, endDate } = parseScapeDate(item.dateText, today);
      let dateText = item.dateText;

      // Some cards omit the date on the listing - fall back to the detail page.
      if (!startDate) {
        await sleep(DETAIL_DELAY_MS);
        const detail = await fetchDetail(item.sourceUrl);
        if (detail?.dateText) {
          dateText = detail.dateText;
          ({ startDate, endDate } = parseScapeDate(detail.dateText, today));
        }
      }

      if (!startDate) {
        dateFailures.push(`"${item.title}" -> "${dateText}"`);
        console.warn(`[scape] Could not parse date for "${item.title}": "${dateText}"`);
        continue;
      }

      parsed.push({ ...item, startDate, endDate: endDate && endDate !== startDate ? endDate : null });
    }

    pageUrl = nextPageUrl;
  }

  if (pageUrl) {
    console.warn(`[scape] Stopped at MAX_PAGES=${MAX_PAGES}; more pages remain`);
  }
  if (totalCards === 0) {
    throw new Error(`[scape] No event cards found on ${LISTING_URL}`);
  }
  if (dateFailures.length >= Math.max(2, totalCards * DATE_FAILURE_RATIO)) {
    throw new Error(
      `[scape] ${dateFailures.length}/${totalCards} event cards had unparseable dates ` +
        `\u2014 date format likely changed: ${dateFailures.join("; ")}`
    );
  }

  // --- Phase 2: persist. ---
  let newEvents = 0;
  let refreshed = 0;

  for (const event of parsed) {
    // Drop events that finished more than a week ago.
    if ((event.endDate ?? event.startDate) < cutoff) continue;

    const exists = await checkEventExists(event.sourceUrl);

    // Only pay for the detail page on first sight; existing rows just get their
    // listing fields refreshed (dates on *SCAPE do shift) with the description left intact.
    let description: string | null = null;
    if (!exists) {
      await sleep(DETAIL_DELAY_MS);
      description = (await fetchDetail(event.sourceUrl))?.description ?? null;
    }

    const result = await upsertEvent({
      source: "scape",
      source_url: event.sourceUrl,
      raw_title: event.title,
      raw_description: description,
      venue: event.venue,
      event_date_start: event.startDate,
      event_date_end: event.endDate,
    });

    if (result.inserted) newEvents++;
    else refreshed++;
  }

  console.log(
    `[scape] ${totalCards} cards across ${page} page(s), ${parsed.length} dated, ` +
      `${dateFailures.length} unparseable, ${refreshed} refreshed, ${newEvents} new events`
  );
  return newEvents;
}
