import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

const BASE_URL = "https://www.srt.com.sg";
const LISTING_URL = `${BASE_URL}/new`;
const USER_AGENT = "SGEventsCuration/1.0";
const FETCH_DELAY_MS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGES = 60;
/** Keep recently-closed runs so "last chance" events don't vanish mid-week. */
const PAST_GRACE_DAYS = 7;
const DEFAULT_VENUE = "KC Arts Centre - Home of SRT";

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/** Hyphen, en dash, em dash, and "to" all appear as range separators on SRT. */
const DASH = "[-\\u2013\\u2014]";

export interface SrtProduction {
  url: string;
  title: string;
  venue: string;
  dateText: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
}

/** A page that looks like a real production but whose date we could not read. */
export interface SrtUnresolved {
  url: string;
  title: string;
  dateText: string;
  reason: string;
}

export interface SrtCollectResult {
  cardsFound: number;
  pagesFetched: number;
  productions: SrtProduction[];
  unresolved: SrtUnresolved[];
  indexPages: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Today in Singapore time — matches the convention used across the app. */
function getTodaySgt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

function normalize(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build an ISO date, returning null if the calendar date does not exist (e.g. 31 Feb). */
function makeDate(year: string | number, month: string, day: string): string | null {
  const yyyy = String(year).padStart(4, "0");
  const dd = day.padStart(2, "0");
  const iso = `${yyyy}-${month}-${dd}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function monthOf(token: string): string | null {
  return MONTH_MAP[token.toLowerCase().replace(/\.$/, "")] ?? null;
}

/**
 * Parse the date half of an SRT date line.
 *
 * Real formats seen on srt.com.sg:
 *   "Now till 11 Sep 2026"      → open run ending on a date
 *   "From 18 Nov 2026"          → open-ended run
 *   "22 Apr - 9 May 2026"       → cross-month range
 *   "11 - 13 Sep 2026"          → same-month range
 *   "28 Nov 2026 - 10 Jan 2027" → cross-year range
 *   "7 Mar 2026"                → single day
 */
export function parseSrtDateText(
  rawText: string,
  todaySgt: string
): { startDate: string | null; endDate: string | null } {
  const text = normalize(rawText);
  if (!text) return { startDate: null, endDate: null };

  const none = { startDate: null, endDate: null };

  // "Now till 11 Sep 2026" / "Now till 11 Sep" — currently running, closes on the given date.
  const nowTill = text.match(
    new RegExp(`^now\\s+(?:till|until|to)\\s+(\\d{1,2})\\s+(\\w+)(?:\\s+(\\d{4}))?$`, "i")
  );
  if (nowTill) {
    const [, day, monthToken, yearToken] = nowTill;
    const month = monthOf(monthToken);
    if (!month) return none;
    let end = makeDate(yearToken ?? todaySgt.slice(0, 4), month, day);
    // No year given: if that date already passed, the run must close next year.
    if (!yearToken && end && end < todaySgt) {
      end = makeDate(Number(todaySgt.slice(0, 4)) + 1, month, day);
    }
    if (!end) return none;
    return { startDate: todaySgt, endDate: end };
  }

  // "From 18 Nov 2026" — opens on a date, close not announced.
  const from = text.match(/^from\s+(\d{1,2})\s+(\w+)(?:\s+(\d{4}))?$/i);
  if (from) {
    const [, day, monthToken, yearToken] = from;
    const month = monthOf(monthToken);
    if (!month) return none;
    let start = makeDate(yearToken ?? todaySgt.slice(0, 4), month, day);
    if (!yearToken && start && start < todaySgt) {
      start = makeDate(Number(todaySgt.slice(0, 4)) + 1, month, day);
    }
    if (!start) return none;
    return { startDate: start, endDate: null };
  }

  // "28 Nov 2026 - 10 Jan 2027" — explicit year on both ends.
  const bothYears = text.match(
    new RegExp(`^(\\d{1,2})\\s+(\\w+)\\s+(\\d{4})\\s*(?:${DASH}|to)\\s*(\\d{1,2})\\s+(\\w+)\\s+(\\d{4})$`, "i")
  );
  if (bothYears) {
    const [, d1, m1, y1, d2, m2, y2] = bothYears;
    const month1 = monthOf(m1);
    const month2 = monthOf(m2);
    if (!month1 || !month2) return none;
    const start = makeDate(y1, month1, d1);
    const end = makeDate(y2, month2, d2);
    if (!start || !end) return none;
    return { startDate: start, endDate: end };
  }

  // "22 Apr - 9 May 2026" — cross-month range, year stated once at the end.
  const crossMonth = text.match(
    new RegExp(`^(\\d{1,2})\\s+(\\w+)\\s*(?:${DASH}|to)\\s*(\\d{1,2})\\s+(\\w+)\\s+(\\d{4})$`, "i")
  );
  if (crossMonth) {
    const [, d1, m1, d2, m2, year] = crossMonth;
    const month1 = monthOf(m1);
    const month2 = monthOf(m2);
    if (!month1 || !month2) return none;
    const start = makeDate(year, month1, d1);
    const end = makeDate(year, month2, d2);
    if (!start || !end) return none;
    // "28 Dec - 10 Jan 2027": the stated year belongs to the end, so pull the start back.
    if (end < start) {
      const rolledStart = makeDate(Number(year) - 1, month1, d1);
      if (!rolledStart) return none;
      return { startDate: rolledStart, endDate: end };
    }
    return { startDate: start, endDate: end };
  }

  // "11 - 13 Sep 2026" — same-month range.
  const sameMonth = text.match(
    new RegExp(`^(\\d{1,2})\\s*(?:${DASH}|to)\\s*(\\d{1,2})\\s+(\\w+)\\s+(\\d{4})$`, "i")
  );
  if (sameMonth) {
    const [, d1, d2, monthToken, year] = sameMonth;
    const month = monthOf(monthToken);
    if (!month) return none;
    const start = makeDate(year, month, d1);
    const end = makeDate(year, month, d2);
    if (!start || !end || end < start) return none;
    return { startDate: start, endDate: end };
  }

  // "7 Mar 2026" — single day.
  const single = text.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
  if (single) {
    const [, day, monthToken, year] = single;
    const month = monthOf(monthToken);
    if (!month) return none;
    const start = makeDate(year, month, day);
    if (!start) return none;
    return { startDate: start, endDate: null };
  }

  return none;
}

/** Split "From 18 Nov 2026 | KC Arts Centre" into its date and venue halves. */
function splitDateLine(line: string): { dateText: string; venue: string | null } {
  const text = normalize(line);
  const pipe = text.indexOf("|");
  if (pipe === -1) return { dateText: text, venue: null };
  return {
    dateText: normalize(text.slice(0, pipe)),
    venue: normalize(text.slice(pipe + 1)) || null,
  };
}

/**
 * Normalise any SRT show link to `https://www.srt.com.sg/show/<slug>/`.
 * Returns null for off-site links and non-show paths.
 */
function canonicalShowUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, BASE_URL);
  } catch {
    return null;
  }
  if (!/(^|\.)srt\.com\.sg$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/show\/([^/]+)\/?$/);
  if (!match) return null;
  return `${BASE_URL}/show/${match[1]}/`;
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return { html: await response.text(), finalUrl: response.url || url };
}

interface JsonLdEvent {
  name?: string;
  startDate?: string;
  endDate?: string;
  location?: { name?: string };
}

/** Read a schema.org Event block — used when SRT redirects a show to a ticket vendor. */
function extractJsonLdEvent($: cheerio.CheerioAPI): JsonLdEvent | null {
  let found: JsonLdEvent | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const parsed = JSON.parse($(el).html() || "");
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && node["@type"] === "Event") {
          found = node as JsonLdEvent;
          return;
        }
      }
    } catch {
      // malformed JSON-LD — ignore
    }
  });
  return found;
}

function isoDay(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Pull readable body copy out of an SRT show page (or an off-site ticketing page). */
function extractDescription($: cheerio.CheerioAPI, onSrt: boolean): string | null {
  if (onSrt) {
    const container = $("p.red").first().parent();
    if (container.length > 0) {
      const clone = container.clone();
      clone.find("script, style, h3, p.red").remove();
      const text = normalize(clone.text());
      if (text.length > 40) return text.slice(0, 2000);
    }
  }

  // Off-site ticketing pages (SRT redirects some shows straight to the vendor).
  let jsonLdDescription: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdDescription) return;
    try {
      const parsed = JSON.parse($(el).html() || "");
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (node && typeof node.description === "string" && node.description.trim()) {
          jsonLdDescription = node.description;
          return;
        }
      }
    } catch {
      // malformed JSON-LD — ignore
    }
  });
  if (jsonLdDescription) {
    return normalize(String(jsonLdDescription).replace(/<[^>]+>/g, " ")).slice(0, 2000);
  }

  const meta = $('meta[name="description"]').attr("content");
  if (meta && normalize(meta).length > 40) return normalize(meta).slice(0, 2000);

  return null;
}

/**
 * Walk the SRT site and return every real production.
 *
 * Discovery: the "What's On" grid at /new lists production cards *and* evergreen
 * marketing cards (careers, donations, corporate training, season overviews).
 * Season overview pages in turn link to productions that have not reached the
 * grid yet, so those are followed one level deep.
 *
 * Classification: a genuine SRT production page always renders `<h3>` (title) plus
 * `<p class="red">` (date | venue). Marketing pages render neither. Shows whose
 * link redirects off-site to a ticketing vendor are trusted from their grid card.
 */
export async function collectSrtProductions(): Promise<SrtCollectResult> {
  const todaySgt = getTodaySgt();

  const listing = await fetchPage(LISTING_URL);
  const $listing = cheerio.load(listing.html);

  interface Candidate {
    url: string;
    cardTitle: string | null;
    cardDateLine: string | null;
    depth: number;
  }

  const queue: Candidate[] = [];
  const seen = new Set<string>();

  const enqueue = (candidate: Candidate) => {
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(candidate);
  };

  const readCards = ($: cheerio.CheerioAPI, depth: number): number => {
    let count = 0;
    $('a[href*="/show/"]').each((_, el) => {
      const $el = $(el);
      const heading = $el.find("h4").first();
      if (heading.length === 0) return;
      const url = canonicalShowUrl($el.attr("href") || "");
      if (!url) return;
      count++;
      const paragraph = $el.find("p").first();
      enqueue({
        url,
        cardTitle: normalize(heading.text()) || null,
        cardDateLine: paragraph.length > 0 ? normalize(paragraph.text()) : null,
        depth,
      });
    });
    return count;
  };

  /**
   * Season overview pages link productions as bare `<a><img></a>` with the title in a
   * sibling `<h4>`, so card parsing does not apply — take every show link and let the
   * detail page classify itself.
   */
  const harvestShowLinks = ($: cheerio.CheerioAPI, depth: number): void => {
    $('a[href*="/show/"]').each((_, el) => {
      const url = canonicalShowUrl($(el).attr("href") || "");
      if (!url) return;
      enqueue({ url, cardTitle: null, cardDateLine: null, depth });
    });
  };

  const cardsFound = readCards($listing, 0);
  if (cardsFound === 0) {
    throw new Error(
      `SRT listing ${LISTING_URL} contained no show cards — markup likely changed`
    );
  }

  const productions: SrtProduction[] = [];
  const unresolved: SrtUnresolved[] = [];
  const indexPages: string[] = [];
  let pagesFetched = 0;

  while (queue.length > 0) {
    const candidate = queue.shift() as Candidate;
    if (pagesFetched >= MAX_PAGES) {
      console.warn(`[srt] Hit MAX_PAGES (${MAX_PAGES}), stopping discovery`);
      break;
    }

    await sleep(FETCH_DELAY_MS);
    pagesFetched++;

    let page: { html: string; finalUrl: string };
    try {
      page = await fetchPage(candidate.url);
    } catch (err) {
      // A dead show link is a content problem, not a structural break — record it.
      unresolved.push({
        url: candidate.url,
        title: candidate.cardTitle ?? candidate.url,
        dateText: candidate.cardDateLine ?? "",
        reason: `detail page fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const $page = cheerio.load(page.html);
    const onSrt = /(^|\.)srt\.com\.sg$/i.test(new URL(page.finalUrl).hostname);

    const heading = normalize($page("h3").first().text());
    const redLine = $page("p.red").first();
    const hasRedLine = redLine.length > 0;

    // Off-site redirect → SRT only sends bookable productions to a ticket vendor.
    // Trust the grid card, which carries the date line.
    if (!onSrt) {
      const { dateText, venue } = splitDateLine(candidate.cardDateLine ?? "");
      const fromCard = parseSrtDateText(dateText, todaySgt);

      // Shows reached via a season page carry no card metadata — fall back to the
      // vendor's schema.org Event block.
      const jsonLd = extractJsonLdEvent($page);
      const title = candidate.cardTitle ?? (jsonLd?.name ? normalize(jsonLd.name) : null);
      const startDate = fromCard.startDate ?? isoDay(jsonLd?.startDate);
      const endDate = fromCard.startDate ? fromCard.endDate : isoDay(jsonLd?.endDate);

      if (!title) {
        unresolved.push({
          url: candidate.url,
          title: candidate.url,
          dateText,
          reason: `redirects to ${page.finalUrl} with no card title and no JSON-LD event name`,
        });
        continue;
      }
      if (!startDate) {
        unresolved.push({
          url: candidate.url,
          title,
          dateText,
          reason: `redirects to ${page.finalUrl} and neither the card date nor JSON-LD gave a start date`,
        });
        continue;
      }
      productions.push({
        url: candidate.url,
        title,
        venue: venue || normalize(jsonLd?.location?.name ?? "") || DEFAULT_VENUE,
        dateText: dateText || `${startDate}${endDate ? ` - ${endDate}` : ""}`,
        startDate,
        endDate: endDate && endDate !== startDate ? endDate : null,
        description: extractDescription($page, false),
      });
      continue;
    }

    // On-site page with neither marker → marketing / season index, not a production.
    if (!heading && !hasRedLine) {
      indexPages.push(candidate.url);
      // Season overview pages link on to productions the grid has not surfaced yet.
      if (candidate.depth === 0) harvestShowLinks($page, candidate.depth + 1);
      continue;
    }

    // Production-shaped page — from here on, a missing date is a bug worth reporting.
    const title = heading || candidate.cardTitle;
    const rawLine = hasRedLine ? normalize(redLine.text()) : candidate.cardDateLine ?? "";
    const { dateText, venue } = splitDateLine(rawLine);

    if (!title) {
      unresolved.push({
        url: candidate.url,
        title: candidate.url,
        dateText,
        reason: "production page has a date line but no readable title",
      });
      continue;
    }
    if (!hasRedLine) {
      unresolved.push({
        url: candidate.url,
        title,
        dateText,
        reason: "production page has <h3> but no <p class=\"red\"> date line",
      });
      continue;
    }

    const { startDate, endDate } = parseSrtDateText(dateText, todaySgt);
    if (!startDate) {
      unresolved.push({
        url: candidate.url,
        title,
        dateText,
        reason: "date line present but not in a recognised format",
      });
      continue;
    }

    productions.push({
      url: candidate.url,
      title,
      venue: venue || DEFAULT_VENUE,
      dateText,
      startDate,
      endDate: endDate && endDate !== startDate ? endDate : null,
      description: extractDescription($page, true),
    });
  }

  return { cardsFound, pagesFetched, productions, unresolved, indexPages };
}

/** Drop runs that closed more than PAST_GRACE_DAYS ago. */
export function filterUpcoming(
  productions: SrtProduction[],
  todaySgt: string
): SrtProduction[] {
  const cutoff = addDaysStr(todaySgt, -PAST_GRACE_DAYS);
  return productions.filter((p) => (p.endDate ?? p.startDate) >= cutoff);
}

export async function scrapeSrt(): Promise<number> {
  await initializeDb();

  const { cardsFound, productions, unresolved, indexPages } = await collectSrtProductions();

  console.log(
    `[srt] ${cardsFound} cards on /new → ${productions.length} productions, ` +
      `${indexPages.length} marketing/index pages skipped`
  );

  // Structural break: cards existed but nothing matched the production contract.
  if (productions.length === 0 && unresolved.length === 0) {
    throw new Error(
      `SRT: parsed ${cardsFound} cards but identified 0 productions — ` +
        `the <h3> + <p class="red"> page contract has likely changed`
    );
  }

  const todaySgt = getTodaySgt();
  const upcoming = filterUpcoming(productions, todaySgt);
  console.log(
    `[srt] ${upcoming.length} of ${productions.length} productions are current or upcoming`
  );

  let newEvents = 0;
  for (const production of upcoming) {
    const result = await upsertEvent({
      source: "srt",
      source_url: production.url,
      raw_title: production.title,
      raw_description: production.description,
      venue: production.venue,
      event_date_start: production.startDate,
      event_date_end: production.endDate,
    });
    if (result.inserted) newEvents++;
  }

  console.log(`[srt] Scraped ${newEvents} new events (${upcoming.length} upserted)`);

  // Surface anything that looked like a production but could not be read.
  // Upserts above are already committed, so this reports without losing data.
  if (unresolved.length > 0) {
    const detail = unresolved
      .map((u) => `"${u.title}" (${u.url}) — ${u.reason}${u.dateText ? ` [line: "${u.dateText}"]` : ""}`)
      .join("; ");
    throw new Error(
      `SRT: ${unresolved.length} production page(s) could not be parsed and need investigation: ${detail}`
    );
  }

  return newEvents;
}
