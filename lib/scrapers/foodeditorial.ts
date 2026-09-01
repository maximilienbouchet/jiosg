import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";
import { titlesMatch } from "../dedup";

// The Honeycombers' "things to do" roundups are hand-written editorial lists.
// They are the only source in jio that reliably covers food festivals, tastings,
// pop-ups, street festivals and gallery months — categories the ticketing-platform
// scrapers miss entirely because those events never sell tickets through Eventbrite
// or SISTIC. Pulled through the public WordPress REST API rather than the rendered
// page: no Cloudflare challenge, clean HTML, one request per post.
const API_ENDPOINT = "https://thehoneycombers.com/singapore/wp-json/wp/v2/posts";
const USER_AGENT = "SGEventsCuration/1.0";

// robots.txt declares "Crawl-delay:3".
const CRAWL_DELAY_MS = 3000;

// Honeycombers pre-creates monthly slugs far ahead and leaves them holding an old
// draft — the October post sat untouched since April. Anything not edited recently
// is a stale shell, not a roundup, and its dates would be a year out.
const MAX_POST_AGE_DAYS = 40;

const MAX_DESCRIPTION_CHARS = 1500;
const MAX_VENUE_CHARS = 120;

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sept: 9, sep: 9,
  oct: 10, nov: 11, dec: 12,
};

// Longest-first so "sept" is never truncated to "sep".
const MONTH_PATTERN =
  "(january|february|march|april|may|june|july|august|september|october|november|december" +
  "|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";

// Headings on the monthly post are prefixed with a section label ("F&B: Sake Sake
// 2026"). Stripped by whitelist only — plenty of real titles carry a colon of their
// own ("Is It You?: Friends Edition", "Sinners: Live") and must survive intact.
const CATEGORY_PREFIXES = new Set([
  "beauty", "f&b", "fnb", "food", "food & drink", "drink", "dining", "eat",
  "theatre", "theater", "shop", "shopping", "style", "fashion", "things to do",
  "arts and culture", "arts & culture", "art", "arts", "culture", "music",
  "film", "movies", "wellness", "fitness", "travel", "kids", "family",
  "sport", "sports", "nightlife", "exhibition", "exhibitions", "concerts",
  "events", "stay", "hotels", "new openings", "openings", "tech",
]);

// Address fragments that are never the venue name.
const UNIT_SEGMENT = /^(#|unit\b|units\b|level\b|lvl\b|blk\b|block\b|b[12]-|l\d\b)/i;
const STREET_SEGMENT = /^\d+[a-z]?\s+\S/i;
const POSTAL_SEGMENT = /^singapore\s*\d{5,6}$/i;

// Honeycombers runs occasional Johor / regional getaway items in the SG edition.
const NON_SG_MARKERS =
  /\b(johor bahru|johor|malaysia|kuala lumpur|penang|batam|bintan|bali|jakarta|bangkok|hong kong|tokyo|seoul|taipei|sydney|melbourne)\b/i;

export interface FoodeditorialEvent {
  title: string;
  description: string | null;
  venue: string;
  source_url: string;
  event_date_start: string;
  event_date_end: string | null;
  /** Outbound ticket/info link from the "Where:" line, when the post had one. */
  outbound_url: string | null;
}

export interface FoodeditorialStats {
  postsParsed: number;
  postsStale: number;
  postsMissing: number;
  sections: number;
  skippedNoWhen: number;
  skippedUnparsableDate: number;
  skippedPast: number;
  skippedNonSg: number;
  skippedDuplicate: number;
}

interface HoneycombersPost {
  link: string;
  modified: string;
  content: { rendered: string };
}

interface ParagraphLink {
  text: string;
  href: string;
}

interface ParagraphData {
  text: string;
  links: ParagraphLink[];
}

interface Section {
  heading: string;
  anchor: string;
  paragraphs: ParagraphData[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string): string {
  return value.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Today in SGT — the cron fires at 03:00 SGT, which is still "yesterday" in UTC. */
export function todayInSingapore(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

/** Mirrors the ez-toc plugin's anchor generation, for posts that ship no inline ids. */
export function slugifyHeading(heading: string): string {
  return normalizeText(heading)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Two roundups per run: the weekly "this weekend" post (required — it is the reason
 * this source exists) plus the current and next monthly posts. The next month is
 * usually a stale shell and gets dropped by the freshness guard; it only carries
 * content in the last days of a month, which is exactly when we want it.
 */
export function buildTargets(todayIso: string): { slug: string; required: boolean }[] {
  const month = Number(todayIso.slice(5, 7)) - 1;
  return [
    { slug: "things-to-do-this-weekend-singapore", required: true },
    { slug: `things-to-do-in-singapore-${MONTH_NAMES[month]}`, required: false },
    { slug: `things-to-do-in-singapore-${MONTH_NAMES[(month + 1) % 12]}`, required: false },
  ];
}

export function cleanTitle(raw: string): string {
  let title = normalizeText(raw);
  title = title.replace(/^\d{1,3}[.)]\s*/, "");
  title = title.replace(/^\[[^\]]*\]\s*/, "");

  const colon = title.indexOf(":");
  if (colon > 0) {
    const prefix = title.slice(0, colon).trim().toLowerCase();
    if (CATEGORY_PREFIXES.has(prefix)) {
      title = title.slice(colon + 1).trim();
    }
  }
  return title;
}

/**
 * The "Where:" line reads "<event name>, <venue>, <street>, Singapore <postal>".
 * The leading repeat of the event name is the anchor text, so strip it and take the
 * first fragment that is not a unit number, street address or postal code.
 */
export function extractVenue(whereText: string, linkText: string | null): string {
  let rest = normalizeText(whereText).replace(/[.;]+$/, "");

  if (linkText) {
    const link = normalizeText(linkText);
    if (link && rest.toLowerCase().startsWith(link.toLowerCase())) {
      rest = rest.slice(link.length).replace(/^[\s,]+/, "");
    }
  }

  const segments = rest.split(",").map((s) => s.trim()).filter(Boolean);
  for (const segment of segments) {
    if (UNIT_SEGMENT.test(segment)) continue;
    if (POSTAL_SEGMENT.test(segment)) continue;
    if (STREET_SEGMENT.test(segment)) continue;
    return segment.slice(0, MAX_VENUE_CHARS);
  }

  return (segments[0] ?? "Singapore").slice(0, MAX_VENUE_CHARS);
}

function normalizeWhen(raw: string): string {
  return normalizeText(raw)
    .toLowerCase()
    .replace(/[–—]/g, "-")
    // Opening hours ("12pm to 8pm") sit in the same sentence as the dates and would
    // otherwise be read as a numeric range.
    .replace(/\b\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)\b/g, " ")
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year: number, month: number, day: number, context: string): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const max = daysInMonth(year, month);
  let resolved = day;
  if (day > max) {
    // The copy desk writes "1 to 31 September" often enough to be worth salvaging.
    console.warn(
      `[foodeditorial] Impossible date ${day}/${month}/${year} clamped to ${max} — "${context}"`,
    );
    resolved = max;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(resolved).padStart(2, "0")}`;
}

/** Monthly posts omit the year, so resolve it against the post's own modified date. */
function inferYear(month: number, refIso: string): number {
  const refYear = Number(refIso.slice(0, 4));
  const refMonth = Number(refIso.slice(5, 7));
  // Roundups only ever look forward; a month well behind the post is next year's.
  return month < refMonth - 1 ? refYear + 1 : refYear;
}

/**
 * Parses the free-text "When:" line. Handles, in order of precedence:
 *   "21 August to 27 September 2026"  → cross-month range
 *   "3 to 6 September 2026"           → shared-month range ("5 and 6 September" too)
 *   "Until 17 September 2026"         → open range running from today
 *   "5 September 2026"                → single day
 * Returns null for recurring or open-ended copy ("Ongoing", "Every Sunday"), which
 * is venue programming rather than an event.
 */
export function parseWhen(
  rawWhen: string,
  refIso: string,
  todayIso: string,
): { start: string; end: string | null } | null {
  const when = normalizeWhen(rawWhen);
  if (!when) return null;

  const crossMonth = when.match(
    new RegExp(
      `\\b(\\d{1,2})\\s+${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?\\s*(?:to|-|until|till|through|thru)\\s*(\\d{1,2})\\s+${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?`,
    ),
  );
  if (crossMonth) {
    const [, d1, m1, y1, d2, m2, y2] = crossMonth;
    const startMonth = MONTHS[m1];
    const endMonth = MONTHS[m2];
    let endYear = y2 ? Number(y2) : inferYear(endMonth, refIso);
    let startYear = y1 ? Number(y1) : (y2 ? Number(y2) : inferYear(startMonth, refIso));

    let start = toIso(startYear, startMonth, Number(d1), when);
    let end = toIso(endYear, endMonth, Number(d2), when);
    if (!start || !end) return null;

    if (end < start) {
      // A range straddling New Year, with the year printed on only one end.
      if (!y1) {
        startYear = endYear - 1;
        start = toIso(startYear, startMonth, Number(d1), when);
      } else if (!y2) {
        endYear = startYear + 1;
        end = toIso(endYear, endMonth, Number(d2), when);
      } else {
        console.warn(`[foodeditorial] Inverted date range, skipping — "${rawWhen}"`);
        return null;
      }
      if (!start || !end || end < start) return null;
    }
    return { start, end: end === start ? null : end };
  }

  const sharedMonth = when.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:to|-|&|and)\\s*(\\d{1,2})\\s+${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?`),
  );
  if (sharedMonth) {
    const [, d1, d2, monthName, yearRaw] = sharedMonth;
    const month = MONTHS[monthName];
    const year = yearRaw ? Number(yearRaw) : inferYear(month, refIso);
    const start = toIso(year, month, Number(d1), when);
    const end = toIso(year, month, Number(d2), when);
    if (!start || !end || end < start) return null;
    return { start, end: end === start ? null : end };
  }

  const openEnded = when.match(
    new RegExp(`\\b(?:until|till|through|thru)\\b[^0-9]{0,24}(\\d{1,2})\\s+${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?`),
  );
  if (openEnded) {
    const [, day, monthName, yearRaw] = openEnded;
    const month = MONTHS[monthName];
    const year = yearRaw ? Number(yearRaw) : inferYear(month, refIso);
    const end = toIso(year, month, Number(day), when);
    if (!end) return null;
    // Already closed — hand back a past single date so the past-event filter drops it.
    if (end <= todayIso) return { start: end, end: null };
    return { start: todayIso, end };
  }

  const single = when.match(
    new RegExp(`\\b(\\d{1,2})\\s+${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?`),
  );
  if (single) {
    const [, day, monthName, yearRaw] = single;
    const month = MONTHS[monthName];
    const year = yearRaw ? Number(yearRaw) : inferYear(month, refIso);
    const start = toIso(year, month, Number(day), when);
    if (!start) return null;
    return { start, end: null };
  }

  return null;
}

/** Splits a "When: … How much: … Where: …" line into its labelled parts. */
function splitDetails(text: string): { when: string; where: string } | null {
  const labels = /\b(when|dates?|how much|price|cost|admission|where|venue)\s*:/gi;
  const parts: { label: string; start: number; end: number }[] = [];

  for (const match of text.matchAll(labels)) {
    const index = match.index ?? 0;
    parts.push({ label: match[1].toLowerCase(), start: index, end: index + match[0].length });
  }
  if (parts.length === 0) return null;

  const valueOf = (names: string[]): string => {
    for (let i = 0; i < parts.length; i++) {
      if (!names.includes(parts[i].label)) continue;
      const stop = i + 1 < parts.length ? parts[i + 1].start : text.length;
      return text.slice(parts[i].end, stop).trim().replace(/^[-–—\s]+/, "").replace(/[,;]+$/, "");
    }
    return "";
  };

  const when = valueOf(["when", "date", "dates"]);
  if (!when) return null;
  return { when, where: valueOf(["where", "venue"]) };
}

function buildAnchorMap($: cheerio.CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $("a.ez-toc-link").each((_, el) => {
    const link = $(el);
    const fragment = (link.attr("href") ?? "").split("#")[1];
    if (!fragment) return;
    for (const key of [link.text(), link.attr("title") ?? ""]) {
      const normalized = normalizeText(key).toLowerCase();
      if (normalized && !map.has(normalized)) map.set(normalized, fragment);
    }
  });
  return map;
}

function collectSections($: cheerio.CheerioAPI): Section[] {
  const anchors = buildAnchorMap($);
  const sections: Section[] = [];
  let current: Section | null = null;
  let stopped = false;

  $("body").children().each((_, el) => {
    if (stopped) return;
    const node = $(el);
    const tag = (el.tagName ?? "").toLowerCase();

    if (tag === "h2" || tag === "h3" || tag === "h4") {
      const heading = normalizeText(node.text());
      // The FAQ block at the foot of every post is boilerplate, not events.
      if (/^frequently asked questions/i.test(heading)) {
        stopped = true;
        current = null;
        return;
      }
      if (!heading) return;

      const inlineId = node.find("span.ez-toc-section[id]").first().attr("id");
      const anchor = inlineId ?? anchors.get(heading.toLowerCase()) ?? slugifyHeading(heading);
      current = { heading, anchor, paragraphs: [] };
      sections.push(current);
      return;
    }

    if (tag === "p" && current) {
      const text = normalizeText(node.text());
      if (!text) return;
      const links = node
        .find("a")
        .map((__, a) => ({ text: normalizeText($(a).text()), href: $(a).attr("href") ?? "" }))
        .get();
      current.paragraphs.push({ text, links });
    }
  });

  return sections;
}

export function parsePost(
  post: HoneycombersPost,
  todayIso: string,
  stats: FoodeditorialStats,
): FoodeditorialEvent[] {
  const $ = cheerio.load(post.content.rendered);
  const sections = collectSections($);
  if (sections.length === 0) {
    throw new Error(`[foodeditorial] No headings found in ${post.link} — markup changed`);
  }

  const refIso = post.modified.slice(0, 10);
  const postUrl = post.link.endsWith("/") ? post.link : `${post.link}/`;
  const events: FoodeditorialEvent[] = [];
  let sectionsWithDetails = 0;

  for (const section of sections) {
    stats.sections++;

    const detailsIndex = section.paragraphs.findIndex((p) => /^\s*when\s*:/i.test(p.text));
    if (detailsIndex === -1) {
      // The lead paragraph and sign-off carry no "When:" line — expected, not a fault.
      stats.skippedNoWhen++;
      continue;
    }

    const details = section.paragraphs[detailsIndex];
    const split = splitDetails(details.text);
    if (!split) {
      stats.skippedNoWhen++;
      continue;
    }
    sectionsWithDetails++;

    const title = cleanTitle(section.heading);
    if (!title) continue;

    if (split.where && NON_SG_MARKERS.test(split.where) && !/\bsingapore\b/i.test(split.where)) {
      stats.skippedNonSg++;
      console.log(`[foodeditorial] Skipping non-Singapore item: "${title}" (${split.where})`);
      continue;
    }

    const dates = parseWhen(split.when, refIso, todayIso);
    if (!dates) {
      // Recurring programming ("Every Sunday", "Ongoing") — no date to publish.
      stats.skippedUnparsableDate++;
      console.log(`[foodeditorial] No usable date for "${title}" — When: "${split.when}"`);
      continue;
    }

    if ((dates.end ?? dates.start) < todayIso) {
      stats.skippedPast++;
      continue;
    }

    const whereLink =
      details.links.find((l) => l.href && split.where.toLowerCase().startsWith(l.text.toLowerCase())) ??
      null;
    const venue = extractVenue(split.where, whereLink?.text ?? null) || "Singapore";

    const body = section.paragraphs
      .filter((_, i) => i !== detailsIndex)
      .map((p) => p.text)
      .join("\n\n");
    const description =
      [body, details.text, whereLink?.href ? `More info: ${whereLink.href}` : ""]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, MAX_DESCRIPTION_CHARS) || null;

    events.push({
      title,
      description,
      venue,
      // No canonical per-event page exists, so the roundup's own ez-toc anchor is the
      // stable identity — it survives weekly post refreshes as long as the heading does.
      source_url: `${postUrl}#${section.anchor}`,
      event_date_start: dates.start,
      event_date_end: dates.end,
      outbound_url: whereLink?.href ?? null,
    });
  }

  if (sectionsWithDetails === 0) {
    throw new Error(
      `[foodeditorial] ${sections.length} sections in ${post.link} but no "When:" lines — post format changed`,
    );
  }

  return events;
}

async function fetchPost(slug: string): Promise<HoneycombersPost | null> {
  const url = `${API_ENDPOINT}?slug=${encodeURIComponent(slug)}&_fields=link,modified,content`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`[foodeditorial] ${url} returned ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`[foodeditorial] Unexpected API response shape for slug "${slug}"`);
  }
  if (payload.length === 0) return null;

  const post = payload[0] as Partial<HoneycombersPost>;
  if (!post.link || !post.modified || typeof post.content?.rendered !== "string") {
    throw new Error(`[foodeditorial] Malformed post payload for slug "${slug}"`);
  }
  return post as HoneycombersPost;
}

/**
 * Fetch + parse only — no database access, so the probe script exercises exactly
 * this code path.
 */
export async function fetchFoodeditorialEvents(): Promise<{
  events: FoodeditorialEvent[];
  stats: FoodeditorialStats;
}> {
  const todayIso = todayInSingapore();
  const stats: FoodeditorialStats = {
    postsParsed: 0,
    postsStale: 0,
    postsMissing: 0,
    sections: 0,
    skippedNoWhen: 0,
    skippedUnparsableDate: 0,
    skippedPast: 0,
    skippedNonSg: 0,
    skippedDuplicate: 0,
  };

  const collected: FoodeditorialEvent[] = [];
  const seenUrls = new Set<string>();
  const targets = buildTargets(todayIso);

  for (let i = 0; i < targets.length; i++) {
    const { slug, required } = targets[i];
    if (i > 0) await sleep(CRAWL_DELAY_MS);

    const post = await fetchPost(slug);
    if (!post) {
      if (required) {
        throw new Error(`[foodeditorial] Required post "${slug}" not found — slug changed`);
      }
      stats.postsMissing++;
      console.warn(`[foodeditorial] No post for slug "${slug}", skipping`);
      continue;
    }

    const ageDays = (Date.parse(todayIso) - Date.parse(post.modified.slice(0, 10))) / 86_400_000;
    if (ageDays > MAX_POST_AGE_DAYS) {
      if (required) {
        throw new Error(
          `[foodeditorial] Required post "${slug}" last modified ${post.modified} — feed has stalled`,
        );
      }
      stats.postsStale++;
      console.log(
        `[foodeditorial] Skipping stale post "${slug}" (modified ${post.modified.slice(0, 10)})`,
      );
      continue;
    }

    const parsed = parsePost(post, todayIso, stats);
    stats.postsParsed++;

    for (const event of parsed) {
      if (seenUrls.has(event.source_url)) continue;

      // The weekly and monthly roundups overlap heavily, and the same event gets
      // re-titled between them ("Kirin Ichiban's First Press Studio" vs "First Press
      // Studio by Kirin Ichiban"), which slips past fuzzy title matching. The shared
      // outbound link is the reliable tie-breaker. Posts are processed in priority
      // order so the earlier post wins; only compare *across* posts, never within
      // one, where near-identical titles are genuinely different entries.
      //
      // This matters more than usual here: display selection caps each source at a
      // few picks per week, so a duplicate would burn a slot outright.
      const duplicate = collected.find((existing) => {
        const overlaps =
          (existing.event_date_end ?? existing.event_date_start) >= event.event_date_start &&
          (event.event_date_end ?? event.event_date_start) >= existing.event_date_start;
        if (!overlaps) return false;
        const sameLink =
          existing.outbound_url !== null && existing.outbound_url === event.outbound_url;
        return sameLink || titlesMatch(existing.title, event.title);
      });
      if (duplicate) {
        stats.skippedDuplicate++;
        console.log(
          `[foodeditorial] Duplicate of "${duplicate.title}" across roundups, skipping "${event.title}"`,
        );
        continue;
      }

      seenUrls.add(event.source_url);
      collected.push(event);
    }
  }

  if (stats.postsParsed === 0) {
    throw new Error("[foodeditorial] No roundup posts could be parsed");
  }

  return { events: collected, stats };
}

export async function scrapeFoodeditorial(): Promise<number> {
  await initializeDb();

  const { events, stats } = await fetchFoodeditorialEvents();
  let newEvents = 0;

  for (const event of events) {
    const result = await upsertEvent({
      source: "foodeditorial",
      source_url: event.source_url,
      raw_title: event.title,
      raw_description: event.description,
      venue: event.venue,
      event_date_start: event.event_date_start,
      event_date_end: event.event_date_end,
    });
    if (result.inserted) newEvents++;
  }

  console.log(
    `[foodeditorial] Parsed ${stats.postsParsed} posts, ${stats.sections} sections → ` +
      `${events.length} events (skipped: ${stats.skippedNoWhen} no-when, ` +
      `${stats.skippedUnparsableDate} undated, ${stats.skippedPast} past, ` +
      `${stats.skippedNonSg} non-SG, ${stats.skippedDuplicate} duplicate), ` +
      `${newEvents} new`,
  );
  return newEvents;
}
