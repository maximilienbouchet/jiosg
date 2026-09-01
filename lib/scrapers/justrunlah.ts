import * as cheerio from "cheerio";
import { checkEventExists, initializeDb, upsertEvent } from "../db";

// JustRunLah! runs Singapore's most complete race calendar — road races, trail
// runs, triathlons. It is the main fix for jio's biggest coverage gap: sport
// and outdoor events, where the other ten sources produce almost nothing.
const LISTING_URL =
  "https://www.justrunlah.com/calendar-of-running-events-singapore/";
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;
// Detail pages cost ~0.8s each, so cap the work a single cron run can do.
const MAX_DETAIL_FETCHES = 40;
const MAX_DESCRIPTION_CHARS = 2000;

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// The calendar is Singapore-only, but listings occasionally drift across the
// causeway. The detail page's "Location:" field is the authority; these markers
// are only used when that field is missing.
const OVERSEAS_MARKERS =
  /\b(malaysia|kuala lumpur|johor bahru|penang bridge|langkawi|batam|bintan|indonesia|jakarta|bali|thailand|bangkok|phuket|vietnam|hong kong|taiwan|taipei|philippines|manila|australia|japan|tokyo)\b/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collapse whitespace, including the &nbsp; that litters every title. */
function clean(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Reject impossible dates (31 September) that would otherwise roll over. */
function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface JustrunlahListingRow {
  title: string;
  url: string;
  /** Null when the listing gives no "at <venue>" fragment. */
  venue: string | null;
  time: string | null;
  categories: string | null;
  eventDate: string;
}

export interface JustrunlahListingResult {
  rows: JustrunlahListingRow[];
  /** Human-readable reasons for every row that was dropped — never silent. */
  skipped: string[];
}

/**
 * Parse the calendar page.
 *
 * Event rows carry a day number and a month name but no year, so the year comes
 * from the "September 2026" banner divs that precede them in document order. A
 * row whose month sits earlier in the year than its banner belongs to the next
 * year (a January row under a December banner).
 */
export function parseJustrunlahListing(
  html: string,
  today: Date
): JustrunlahListingResult {
  const $ = cheerio.load(html);
  const rows: JustrunlahListingRow[] = [];
  const skipped: string[] = [];

  const rowElements = $(".calendartrdiv");
  if (rowElements.length === 0) {
    throw new Error(
      "[justrunlah] No .calendartrdiv rows found on the calendar page — markup changed"
    );
  }

  // Banner divs are leaf divs whose entire text is "<Month> <Year>". Matching on
  // that rather than the inline background-color survives a restyle.
  const bannerMatch = (node: ReturnType<typeof $>): RegExpMatchArray | null => {
    if (node.children().length > 0) return null;
    const match = clean(node.text()).match(/^([A-Za-z]{3,9})\s+(20\d{2})$/);
    return match && match[1].toLowerCase() in MONTHS ? match : null;
  };
  const isRow = (node: ReturnType<typeof $>): boolean =>
    (node.attr("class") || "").split(/\s+/).includes("calendartrdiv");

  let bannerCount = 0;
  let contextMonth: number | null = null;
  let contextYear: number | null = null;

  // A single page-wide div selection keeps banners and rows in document order.
  const nodes = $("div").filter(
    (_, el) => isRow($(el)) || bannerMatch($(el)) !== null
  );

  nodes.each((_, el) => {
    const node = $(el);

    if (!isRow(node)) {
      const match = bannerMatch(node);
      if (match) {
        contextMonth = MONTHS[match[1].toLowerCase()];
        contextYear = Number(match[2]);
        bannerCount++;
      }
      return;
    }

    const link = node
      .find('a[href*="/race/"]')
      .filter((__, a) => clean($(a).text()).length > 0)
      .first();
    const title = clean(link.text());
    const href = link.attr("href");
    if (!title || !href) {
      skipped.push(`row with no race link: ${clean(node.text()).slice(0, 80)}`);
      return;
    }
    const url = href.trim().replace(/^http:\/\//, "https://");

    const dayCell = node.find("td").first();
    const dayText =
      dayCell
        .find("span")
        .filter((__, s) => ($(s).attr("style") || "").includes("font-size: 3em"))
        .first()
        .text() || clean(dayCell.text()).match(/\b(\d{1,2})\b/)?.[1] || "";
    const day = Number(clean(dayText));

    // The row states its own month; the banner only supplies the year.
    let month: number | null = null;
    dayCell.find("span").each((__, s) => {
      const name = clean($(s).text()).toLowerCase();
      if (month === null && name in MONTHS) month = MONTHS[name];
    });
    if (month === null) month = contextMonth;

    let year = contextYear;
    if (year === null) {
      // No banner seen yet — fall back to a today-relative guess and say so.
      const todayMonth = today.getMonth() + 1;
      year = today.getFullYear();
      if (month !== null && month < todayMonth - 1) year++;
      skipped.push(`no month banner before "${title}" — year inferred as ${year}`);
    } else if (month !== null && contextMonth !== null && month < contextMonth) {
      year++;
    }

    const eventDate = month !== null && day ? toIsoDate(year, month, day) : null;
    if (!eventDate) {
      skipped.push(
        `unparseable date for "${title}" (day="${clean(dayText)}", month=${month}, year=${year})`
      );
      return;
    }

    // "07:00 am, at Woodlands Stadium" / "Flag-off TBC, at Marina Barrage"
    const titleDiv = link.parent();
    let info = clean(titleDiv.next("div").text());
    if (!/,\s*at\s+/i.test(info)) {
      // Innermost matching div only — an outer wrapper would drag the title in.
      const fallback = node
        .find("div")
        .filter((__, d) => {
          const candidate = $(d);
          if (candidate.find("div").length > 0) return false;
          const text = clean(candidate.text());
          return /,\s*at\s+/i.test(text) && !text.startsWith("Categories:");
        })
        .first();
      info = clean(fallback.text());
    }
    const infoMatch = info.match(/^(.*?),\s*at\s+(.+)$/i);
    const time = infoMatch ? clean(infoMatch[1]) || null : null;
    const venue = infoMatch
      ? clean(infoMatch[2])
          .replace(/\s*Categories:.*$/i, "")
          .replace(/,\s*singapore$/i, "")
          .trim() || null
      : null;

    const categories =
      clean(
        node
          .find("div")
          .filter((__, d) => clean($(d).text()).startsWith("Categories:"))
          .first()
          .text()
      ).replace(/^Categories:\s*/, "") || null;

    rows.push({ title, url, venue, time, categories, eventDate });
  });

  if (bannerCount === 0) {
    throw new Error(
      "[justrunlah] No month banners found on the calendar page — cannot resolve event years"
    );
  }
  if (rows.length === 0) {
    throw new Error(
      `[justrunlah] Found ${rowElements.length} calendar rows but parsed 0 events — markup changed`
    );
  }

  return { rows, skipped };
}

export interface JustrunlahDetail {
  eventDate: string | null;
  eventDateEnd: string | null;
  venue: string | null;
  time: string | null;
  location: string | null;
  categories: string | null;
  prose: string | null;
  fees: string | null;
}

// Boilerplate sections on every race page — none of them describe the event.
const SKIP_SECTIONS = [
  "entry fees",
  "runner's entitlement",
  "runners entitlement",
  "race apparel",
  "finisher medal",
  "route maps",
  "discuss",
  "comment",
  "reviews",
  "results",
  "photos",
];

/**
 * Detail-page "Date:" values carry an explicit year and occasionally a range
 * ("31 October – 1 November 2026"), so they beat the listing's year inference.
 */
function parseDetailDate(value: string): { start: string | null; end: string | null } {
  const text = clean(value);
  const range = text.match(
    /(\d{1,2})\s*(?:[–—-]|to)\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i
  );
  if (range) {
    const month = MONTHS[range[3].toLowerCase()];
    if (month) {
      const year = Number(range[4]);
      return {
        start: toIsoDate(year, month, Number(range[1])),
        end: toIsoDate(year, month, Number(range[2])),
      };
    }
  }

  const crossMonth = text.match(
    /(\d{1,2})\s+([A-Za-z]+)\s*(?:[–—-]|to)\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/i
  );
  if (crossMonth) {
    const startMonth = MONTHS[crossMonth[2].toLowerCase()];
    const endMonth = MONTHS[crossMonth[4].toLowerCase()];
    if (startMonth && endMonth) {
      const endYear = Number(crossMonth[5]);
      // "31 December – 1 January 2027" starts in the previous year.
      const startYear = startMonth > endMonth ? endYear - 1 : endYear;
      return {
        start: toIsoDate(startYear, startMonth, Number(crossMonth[1])),
        end: toIsoDate(endYear, endMonth, Number(crossMonth[3])),
      };
    }
  }

  const single = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/);
  if (single) {
    const month = MONTHS[single[2].toLowerCase()];
    if (month) {
      return { start: toIsoDate(Number(single[3]), month, Number(single[1])), end: null };
    }
  }

  return { start: null, end: null };
}

export function parseJustrunlahDetail(html: string): JustrunlahDetail {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const fields = new Map<string, string>();
  $(".racepagetableleft tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    const label = clean($(cells[0]).text()).replace(/:$/, "").toLowerCase();
    const value = clean($(cells[1]).text());
    if (label && value) fields.set(label, value);
  });

  const { start, end } = parseDetailDate(fields.get("date") || "");

  const proseParts: string[] = [];
  let fees: string | null = null;

  $(".segmentblock").each((_, el) => {
    const block = $(el);
    // The first block is the info table + hero image, not prose.
    if (block.find(".racepagetableleft").length > 0) return;

    const header = clean(block.find(".segmentheader").first().text())
      .replace(/:$/, "")
      .toLowerCase();
    const body = clean(block.find(".segmentbody").first().text());
    if (!body) return;

    if (header.startsWith("entry fees")) {
      fees = body;
      return;
    }
    if (SKIP_SECTIONS.some((skip) => header.startsWith(skip))) return;
    // A "More about this event" block that is only outbound links adds nothing.
    if (/^(official website|facebook|instagram)([\s|]|$)/i.test(body) && body.length < 60) {
      return;
    }
    proseParts.push(body);
  });

  return {
    eventDate: start,
    eventDateEnd: end && start && end > start ? end : null,
    venue: fields.get("venue") || null,
    time: fields.get("time") || null,
    location: fields.get("location") || null,
    categories: fields.get("categories") || null,
    prose: proseParts.join(" ").trim() || null,
    fees,
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-10-25" → "25 October 2026". */
function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const name = MONTH_NAMES[month - 1];
  return name ? `${day} ${name} ${year}` : iso;
}

/**
 * Build the stored description.
 *
 * This has to stand on its own: enrichDescription() is useless on this domain
 * (every race page serves the same "Price, tickets, venue, information, maps,
 * routes for X" meta description), so a thin raw_description would be silently
 * replaced with boilerplate before the LLM ever sees the event.
 */
export function buildJustrunlahDescription(
  row: JustrunlahListingRow,
  detail: JustrunlahDetail | null
): string {
  const categories = detail?.categories || row.categories;
  const time = detail?.time || row.time;
  const isMultisport = /triathlon|duathlon|biathlon|aquathlon|swim|cycl/i.test(
    `${row.title} ${categories ?? ""}`
  );

  const parts: string[] = [
    isMultisport ? "Multisport race in Singapore." : "Running event in Singapore.",
  ];
  if (categories && categories.toLowerCase() !== "others") {
    parts.push(`Distances: ${categories}.`);
  }
  if (time && !/^(tbc|tba)$/i.test(time)) parts.push(`Flag-off: ${time}.`);
  if (detail?.prose) {
    parts.push(detail.prose);
  } else {
    // No write-up on the race page: spell out the facts instead, so the stored
    // description clears the 100-char enrichment threshold in lib/llm.ts.
    const venue = detail?.venue || row.venue;
    parts.push(
      `Race day: ${formatLongDate(row.eventDate)}${venue ? ` at ${venue}` : ""}.`
    );
  }
  if (detail?.fees) parts.push(`Entry fees: ${detail.fees}`);

  return clean(parts.join(" ")).slice(0, MAX_DESCRIPTION_CHARS);
}

async function fetchPage(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`[justrunlah] ${url} returned ${response.status}`);
  }
  return response.text();
}

export async function scrapeJustrunlah(): Promise<number> {
  await initializeDb();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const { rows, skipped } = parseJustrunlahListing(
    await fetchPage(LISTING_URL, 15_000),
    today
  );
  for (const reason of skipped) {
    console.warn(`[justrunlah] Skipped ${reason}`);
  }

  let newEvents = 0;
  let detailFetches = 0;
  let pastCount = 0;
  let knownCount = 0;
  let overseasCount = 0;
  let detailFailures = 0;

  for (const row of rows) {
    if (row.eventDate < todayIso) {
      pastCount++;
      continue;
    }
    // Races already in the database keep their enriched description; re-fetching
    // their detail pages every night would burn the cron's time budget.
    if (await checkEventExists(row.url)) {
      knownCount++;
      continue;
    }
    if (detailFetches >= MAX_DETAIL_FETCHES) {
      console.warn(
        `[justrunlah] Hit detail fetch cap (${MAX_DETAIL_FETCHES}); remaining events wait for the next run`
      );
      break;
    }

    // Detail pages are the only place with a real description, an explicit year
    // and a Location field, so an event without one is left for tomorrow's run
    // rather than stored half-blind.
    detailFetches++;
    await sleep(DETAIL_DELAY_MS);
    let detail: JustrunlahDetail;
    try {
      detail = parseJustrunlahDetail(await fetchPage(row.url, 10_000));
    } catch (err) {
      detailFailures++;
      console.warn(`[justrunlah] Detail fetch failed for ${row.url}, retrying next run:`, err);
      continue;
    }

    const location = detail.location;
    const isOverseas = location
      ? !/singapore/i.test(location)
      : OVERSEAS_MARKERS.test(`${row.title} ${row.venue ?? ""}`);
    if (isOverseas) {
      overseasCount++;
      console.log(
        `[justrunlah] Skipping non-Singapore event "${row.title}" (${location ?? row.venue ?? "unknown location"})`
      );
      continue;
    }

    // Prefer the detail page's date: it states the year outright.
    const eventDate = detail.eventDate ?? row.eventDate;
    if (detail.eventDate && detail.eventDate !== row.eventDate) {
      console.warn(
        `[justrunlah] Date mismatch for "${row.title}": listing ${row.eventDate}, detail page ${detail.eventDate} — using detail page`
      );
    }
    if (eventDate < todayIso) {
      pastCount++;
      continue;
    }

    const result = await upsertEvent({
      source: "justrunlah",
      source_url: row.url,
      raw_title: row.title,
      raw_description: buildJustrunlahDescription(row, detail),
      venue: detail.venue || row.venue || "Singapore",
      event_date_start: eventDate,
      event_date_end: detail.eventDateEnd,
    });

    if (result.inserted) newEvents++;
  }

  console.log(
    `[justrunlah] Parsed ${rows.length} calendar rows (${knownCount} already known, ${pastCount} past, ${overseasCount} non-Singapore, ${detailFailures} detail failures), scraped ${newEvents} new events`
  );
  return newEvents;
}
