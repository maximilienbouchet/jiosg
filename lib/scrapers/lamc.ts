import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

// LAMC Presents is Singapore's main independent concert promoter — international
// touring acts (Slowdive, Two Door Cinema Club, Happy Mondays, Ash) at Fort
// Canning Green, Capitol Theatre and Esplanade. These shows go on sale months
// ahead and often sell out before they surface on any ticketing aggregator, so
// they were invisible to jio's existing sources.
const LISTING_URL = "https://lamcpresents.com/upcoming-shows/";
const ORIGIN = "https://lamcpresents.com";
const USER_AGENT = "SGEventsCuration/1.0";
// The site sits behind a slow CDN (3-10s per page). Detail pages are fetched in
// parallel so the whole scraper stays under the 50s per-scraper cap in index.ts.
const FETCH_TIMEOUT_MS = 20_000;
const MAX_DESCRIPTION_CHARS = 1500;

// Poster tiles share their markup with site chrome, so filter first-level slugs
// that are pages rather than shows.
const NON_SHOW_SLUGS = new Set([
  "upcoming-shows",
  "show-history",
  "history",
  "ticketing",
  "artists-booking",
  "words-music",
  "terms-of-use",
  "privacy-policy",
  "cookie-policy",
  "membership",
  "gig-shop",
  "rising-star-series",
  "singapore-rockfest",
  "comedy",
  "contact-us",
  "about",
  "about-us",
  "faq",
  "news",
  "feed",
]);

// LAMC promotes its regional dates (Manila, KL, Jakarta) on the same listing.
// Only the first word after "Live in" is needed to tell those apart.
const NON_SG_CITY_WORDS = new Set([
  "manila",
  "kuala",
  "jakarta",
  "bangkok",
  "hong",
  "macau",
  "taipei",
  "seoul",
  "tokyo",
  "osaka",
  "hanoi",
  "ho",
  "penang",
  "mumbai",
  "sydney",
  "melbourne",
  "shanghai",
  "beijing",
]);

// Corroborating signal: SG shows always ticket via sistic.com.sg, regional ones
// via a local ccTLD (Manila → ticketnet.com.ph).
const NON_SG_TICKET_TLD =
  /\.(ph|my|th|id|hk|jp|kr|tw|vn|au|nz|cn|in|uk|us)$/i;

const MONTHS: Record<string, number> = {
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

export interface LamcShow {
  url: string;
  title: string;
  /** ISO YYYY-MM-DD, or null when neither parse path found a date. */
  date: string | null;
  venue: string | null;
  time: string | null;
  ticketUrl: string | null;
  description: string | null;
  isSingapore: boolean;
  /** Why the show was classified as outside Singapore (null when SG). */
  nonSgReason: string | null;
}

function clean(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Cap description length, cutting on a word boundary rather than mid-word. */
function truncate(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  const cut = text.slice(0, MAX_DESCRIPTION_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_DESCRIPTION_CHARS - 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  // Rejects impossible dates like "February 31" that would otherwise roll over.
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Show pages are hand-authored, so dates arrive in both orders:
 *   "December 12, 2026 (Saturday)"  — fact sheet / labelled fields
 *   "Sat, 12 December 2026, 8pm"    — hero block under the poster
 * Both carry an explicit year, so nothing has to be inferred from today.
 */
export function parseLamcDate(raw: string): string | null {
  const text = clean(raw).toLowerCase();

  // Month first: "December 12, 2026"
  const monthFirst = text.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1]];
    if (month) {
      const iso = toIsoDate(Number(monthFirst[3]), month, Number(monthFirst[2]));
      if (iso) return iso;
    }
  }

  // Day first: "12 December 2026"
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]];
    if (month) {
      const iso = toIsoDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
      if (iso) return iso;
    }
  }

  return null;
}

/** Split an HTML fragment into rendered lines, honouring block and <br> breaks. */
function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|td|tr|section|article|blockquote)>/gi, "$&\n");
  return cheerio
    .load(`<div>${withBreaks}</div>`)("div")
    .text()
    .split("\n")
    .map(clean)
    .filter(Boolean);
}

/**
 * Normalise the SHOW DETAILS tab into "Label: value" lines. Three layouts are in
 * use across current pages: a two-column fact-sheet table, labelled spans
 * ("Date: December 12, 2026"), and emoji paragraphs ("📅 Date: 15 November 2026").
 */
function showDetailLines(paneHtml: string): string[] {
  const $ = cheerio.load(`<div id="lamc-pane">${paneHtml}</div>`);
  const lines: string[] = [];

  $("tr").each((_, row) => {
    const cells = $(row).children("td,th");
    if (cells.length < 2) return;
    const label = clean(cells.eq(0).text());
    const value = clean(cells.eq(1).text());
    if (label && value) lines.push(`${label}: ${value}`);
  });

  $("table").remove();
  lines.push(...htmlToLines($("#lamc-pane").html() ?? ""));

  return lines;
}

/**
 * Read a labelled field. An explicit separator is required so "On-Sale Dates:"
 * can never be mistaken for "Date:". The leading character class skips the emoji
 * bullets some pages put in front of the label.
 */
function fieldValue(lines: string[], label: string): string | null {
  const pattern = new RegExp(`^[^A-Za-z0-9]{0,4}${label}\\b\\s*[:\\-–—]\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return null;
}

/**
 * Fallback for pages that omit the SHOW DETAILS tab: the block under the poster
 * is an <h4> reading Title / date / venue, separated by <br>.
 */
function parseHeroBlock($: cheerio.CheerioAPI): { date: string | null; venue: string | null } {
  let date: string | null = null;
  let venue: string | null = null;

  $(".wvc-text-block h4").each((_, el) => {
    if (date) return;
    const parts = htmlToLines($(el).html() ?? "");
    for (let i = 0; i < parts.length; i++) {
      const parsed = parseLamcDate(parts[i]);
      if (!parsed) continue;
      date = parsed;
      const next = parts[i + 1];
      // A venue name, not a paragraph of copy that happened to follow.
      venue = next && next.length <= 120 ? next : null;
      return;
    }
  });

  return { date, venue };
}

function classifyLocation(
  title: string,
  url: string,
  ticketUrl: string | null
): { isSingapore: boolean; nonSgReason: string | null } {
  let slug = url;
  try {
    slug = decodeURIComponent(url);
  } catch {
    // Malformed percent-encoding — fall back to the raw URL.
  }
  const haystack = `${title} ${slug.replace(/[-/]/g, " ")}`;
  const cityMatch = haystack.match(/\blive\s+in\s+([a-z][a-z'.]*)/i);
  const city = cityMatch ? cityMatch[1].toLowerCase() : null;

  if (city === "singapore") return { isSingapore: true, nonSgReason: null };
  if (city && NON_SG_CITY_WORDS.has(city)) {
    return { isSingapore: false, nonSgReason: `title says "live in ${city}"` };
  }

  if (ticketUrl) {
    try {
      const host = new URL(ticketUrl).hostname;
      if (NON_SG_TICKET_TLD.test(host)) {
        return { isSingapore: false, nonSgReason: `tickets sold via ${host}` };
      }
    } catch {
      // Unparseable ticket link tells us nothing about the city.
    }
  }

  // LAMC is a Singapore promoter; assume SG unless something says otherwise.
  return { isSingapore: true, nonSgReason: null };
}

/** Pull show URLs off the listing page. Pure so the probe can exercise it. */
export function extractShowUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  $(`a.wvc-si-link[href^="${ORIGIN}"]`).each((_, el) => {
    const href = ($(el).attr("href") ?? "").split(/[?#]/)[0];
    const path = href.slice(ORIGIN.length).replace(/^\/+|\/+$/g, "");
    // One tile is the LAMC logo, which links back to the homepage.
    if (!path) return;
    // Show pages are always first-level slugs.
    if (path.includes("/")) return;
    if (NON_SHOW_SLUGS.has(path.toLowerCase())) return;

    const normalized = `${ORIGIN}/${path}/`;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  });

  return urls;
}

/** Parse one show page. Pure so the probe can exercise it. */
export function parseShowPage(html: string, url: string): LamcShow {
  const $ = cheerio.load(html);

  const ogTitle = clean($('meta[property="og:title"]').attr("content") ?? "");
  const ogDescription = clean($('meta[property="og:description"]').attr("content") ?? "");
  const pageTitle = clean($("title").first().text()).replace(/\s*[-|–]\s*LAMC Presents.*$/i, "");
  const title = ogTitle || pageTitle;
  if (!title) {
    throw new Error(`[lamc] No title found at ${url} — markup changed`);
  }

  // Tabs: SYNOPSIS / ARTIST PROFILE / PRICE DETAILS / SHOW DETAILS / ...
  const tabs = $(".wvc-tabs").first();
  const menu = tabs
    .find(".wvc-tabs-menu > li")
    .map((_, el) => clean($(el).text()))
    .get();
  const panes = tabs.find(".wvc-tabs-container").first().children();
  const paneHtml = (labelPattern: RegExp): string | null => {
    const index = menu.findIndex((label) => labelPattern.test(label));
    if (index < 0 || index >= panes.length) return null;
    return panes.eq(index).html();
  };

  const detailsHtml = paneHtml(/show\s*details/i);
  const detailLines = detailsHtml ? showDetailLines(detailsHtml) : [];
  const rawDate = fieldValue(detailLines, "date");
  const detailsVenue = fieldValue(detailLines, "venue");
  const time = fieldValue(detailLines, "time");

  const hero = parseHeroBlock($);
  const detailsDate = rawDate ? parseLamcDate(rawDate) : null;
  let date = detailsDate ?? hero.date;
  if (detailsDate && hero.date && detailsDate !== hero.date) {
    // The SHOW DETAILS tab is a free-form page-builder block: on the ASH page it
    // holds on-sale dates instead of the show date. A pre-sale always precedes
    // the show, so take the later of the two rather than silently filing a live
    // concert in the past (where it would be dropped as expired).
    date = detailsDate > hero.date ? detailsDate : hero.date;
    console.warn(
      `[lamc] Date disagreement at ${url}: details=${detailsDate} hero=${hero.date} — using ${date}`
    );
  }
  // Both blocks name the venue; the labelled field is the more precise of the
  // two ("Fort Canning Green @ Fort Canning Park" vs "Fort Canning Park").
  const venue = detailsVenue ?? hero.venue;

  const ticketUrl =
    $("a[data-text*='TICKET' i]").first().attr("href") ??
    $("a[href*='sistic']").first().attr("href") ??
    null;

  const synopsisHtml = paneHtml(/synopsis/i);
  const synopsis = synopsisHtml ? clean(cheerio.load(synopsisHtml).text()) : "";
  // og:description is a hand-written teaser; the synopsis tab carries the real
  // copy. Together they are rich enough that lib/enrich.ts never has to refetch.
  const parts = [...new Set([ogDescription, synopsis].filter(Boolean))];
  const description = parts.length > 0 ? truncate(parts.join(" — ")) : null;

  const { isSingapore, nonSgReason } = classifyLocation(title, url, ticketUrl);

  return {
    url,
    title,
    date,
    venue,
    time,
    ticketUrl,
    description,
    isSingapore,
    nonSgReason,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`[lamc] ${url} returned ${response.status}`);
  }
  return response.text();
}

export interface LamcFetchResult {
  shows: LamcShow[];
  /** Detail pages that failed to fetch or parse. */
  failures: string[];
}

/**
 * Two-hop fetch: listing, then every detail page in parallel. No database
 * access, so scripts/_probe-lamc.ts can run the exact production parse path.
 */
export async function fetchLamcShows(): Promise<LamcFetchResult> {
  const listingHtml = await fetchHtml(LISTING_URL);
  const urls = extractShowUrls(listingHtml);
  if (urls.length === 0) {
    throw new Error(`[lamc] No show links found at ${LISTING_URL} — markup changed`);
  }

  const results = await Promise.all(
    urls.map(async (url): Promise<LamcShow | { failedUrl: string }> => {
      try {
        return parseShowPage(await fetchHtml(url), url);
      } catch (err) {
        console.warn(`[lamc] Failed to fetch/parse ${url}:`, err);
        return { failedUrl: url };
      }
    })
  );

  const shows = results.filter((r): r is LamcShow => !("failedUrl" in r));
  const failures = results
    .filter((r): r is { failedUrl: string } => "failedUrl" in r)
    .map((r) => r.failedUrl);

  if (shows.length === 0) {
    throw new Error(`[lamc] Found ${urls.length} show links but parsed 0 pages — markup changed`);
  }
  if (failures.length > 0) {
    console.warn(`[lamc] ${failures.length}/${urls.length} detail pages failed: ${failures.join(", ")}`);
  }

  return { shows, failures };
}

export async function scrapeLamc(): Promise<number> {
  await initializeDb();

  const { shows } = await fetchLamcShows();
  const todayIso = new Date().toISOString().slice(0, 10);

  let newEvents = 0;
  let skippedNonSg = 0;
  let skippedNoDate = 0;
  let skippedPast = 0;

  for (const show of shows) {
    if (!show.isSingapore) {
      console.log(`[lamc] Skipping non-Singapore show "${show.title}" (${show.nonSgReason})`);
      skippedNonSg++;
      continue;
    }
    if (!show.date) {
      console.warn(`[lamc] No parseable date for "${show.title}" (${show.url}) — skipping`);
      skippedNoDate++;
      continue;
    }
    if (show.date < todayIso) {
      console.log(`[lamc] Skipping past show "${show.title}" (${show.date})`);
      skippedPast++;
      continue;
    }
    if (!show.venue) {
      console.warn(`[lamc] No venue found for "${show.title}" (${show.url}) — using "Singapore"`);
    }

    const result = await upsertEvent({
      source: "lamc",
      source_url: show.url,
      raw_title: show.title,
      raw_description: show.description,
      venue: show.venue ?? "Singapore",
      // LAMC promotes single-night concerts; there are no runs to close out.
      event_date_start: show.date,
      event_date_end: null,
    });

    if (result.inserted) newEvents++;
  }

  console.log(
    `[lamc] Parsed ${shows.length} shows, scraped ${newEvents} new events ` +
      `(skipped ${skippedNonSg} non-SG, ${skippedPast} past, ${skippedNoDate} undated)`
  );
  return newEvents;
}
