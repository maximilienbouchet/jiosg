import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

// The Singapore Grand Prix is the single biggest event in Singapore's calendar
// and was entirely absent from jio: no source covered it, and the race-weekend
// concert line-up (Lana Del Rey, The Killers, Janet Jackson...) is a genuine
// big-name music programme that our other sources never list either.
//
// The line-up page is a Next.js app; everything we need is server-rendered into
// the #__NEXT_DATA__ blob, so no browser or API key is needed.
// Season-agnostic entry point: it 302s to the current line-up page
// (.../2026-entertainment-line-up/ today), so the scraper follows the CMS into
// next season instead of pinning a URL that goes stale every October.
const LISTING_URL = "https://singaporegp.sg/en/entertainment/";
const ARTIST_URL_BASE = "https://singaporegp.sg/en/entertainment/";
const RACE_URL = "https://singaporegp.sg/en/tickets";
const CIRCUIT = "Marina Bay Street Circuit";
const USER_AGENT = "SGEventsCuration/1.0";

// Roving acts are walkabout street performers (stilt walkers, samba troupes)
// with no stage and no set time — festival ambience, not something anyone
// attends on purpose. Everything else is left for the LLM filter to judge.
const SKIPPED_CATEGORIES = new Set(["roving acts"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A single performance slot: one artist, one day, one stage. */
interface Slot {
  date: string;
  startTime: string | null;
  endTime: string | null;
  stage: string | null;
}

/** One artist, with every slot they play across the race weekend. */
interface Artist {
  slug: string;
  title: string;
  category: string;
  description: string | null;
  slots: Slot[];
}

/** An event ready to be written to the DB — mirrors the upsertEvent payload. */
export interface SingaporegpEvent {
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
}

/**
 * Titles and bios come out of the CMS as HTML with entities: "PORTUGAL. THE&nbsp;MAN",
 * "F1<sup>&reg;</sup> DRIVERS' FAN FORUM", bios wrapped in <p> tags. Decode entities
 * and flatten to plain text, turning block boundaries into spaces so words that sit
 * in adjacent <p> tags don't get glued together.
 */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return "";
  const spaced = input.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, " ");
  const text = cheerio.load(`<div>${spaced}</div>`)("div").text();
  // \s in JS covers &nbsp; ( ) and &emsp; ( ) once decoded.
  return text.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The `entertainments` blob is CMS-shaped and inconsistent: each category holds
 * some mix of `grouped` / `dateMap` / `items`, nested to different depths, and a
 * few values are plain booleans. Rather than hard-code those shapes (which would
 * silently break next season), walk the whole tree and collect anything that
 * looks like a performance slot: an object carrying both `parent_slug` and `date`.
 */
function collectSlotNodes(root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node.date === "string" && isRecord(node.parent_slug)) {
      found.push(node);
      // Don't descend: parent_slug is the artist record, not more slots.
      return;
    }

    for (const value of Object.values(node)) walk(value);
  };

  walk(root);
  return found;
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "9 - 11 Oct 2026" / "30 Sep - 2 Oct 2026" */
function formatRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const sMonth = s.toLocaleDateString("en-GB", { month: "short" });
  const eMonth = e.toLocaleDateString("en-GB", { month: "short" });
  const year = e.getFullYear();
  if (start === end) return `${s.getDate()} ${sMonth} ${year}`;
  return sMonth === eMonth && s.getFullYear() === year
    ? `${s.getDate()}–${e.getDate()} ${sMonth} ${year}`
    : `${s.getDate()} ${sMonth} – ${e.getDate()} ${eMonth} ${year}`;
}

/** "Fri 9 Oct, 22:30-23:45 at Padang Stage" — degrades if times/stage are null. */
function formatSlot(slot: Slot): string {
  const parts = [formatDay(slot.date)];
  if (slot.startTime) {
    parts.push(slot.endTime ? `${slot.startTime}–${slot.endTime}` : slot.startTime);
  }
  const line = parts.join(", ");
  return slot.stage ? `${line} at ${slot.stage}` : line;
}

/**
 * The Esplanade theatres sit inside the circuit park during race weekend but are
 * real named venues in their own right — "Singtel Waterfront Theatre at Esplanade,
 * Marina Bay Street Circuit" reads as nonsense, so leave those alone.
 */
function buildVenue(stage: string | null): string {
  if (!stage) return CIRCUIT;
  if (/esplanade/i.test(stage)) return stage;
  return `${stage}, ${CIRCUIT}`;
}

/**
 * Parse the line-up page into events. Pure — no network, no DB — so the probe
 * script can exercise exactly this code path.
 *
 * @param html    Raw HTML of the entertainment line-up page
 * @param todayIso Today in SGT (YYYY-MM-DD); anything earlier is dropped
 */
export function parseLineup(html: string, todayIso: string): SingaporegpEvent[] {
  const $ = cheerio.load(html);
  const rawJson = $("#__NEXT_DATA__").html();
  if (!rawJson) {
    throw new Error(
      `[singaporegp] No #__NEXT_DATA__ script found at ${LISTING_URL} — page structure changed`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`[singaporegp] Failed to parse #__NEXT_DATA__ JSON: ${String(err)}`);
  }

  const props = isRecord(data) && isRecord(data.props) ? data.props : null;
  const pageProps = props && isRecord(props.pageProps) ? props.pageProps : null;
  if (!pageProps) {
    throw new Error("[singaporegp] #__NEXT_DATA__ has no props.pageProps — shape changed");
  }

  const entertainments = pageProps.entertainments;
  if (!isRecord(entertainments) || Object.keys(entertainments).length === 0) {
    throw new Error("[singaporegp] pageProps.entertainments missing or empty — shape changed");
  }

  const slotNodes = collectSlotNodes(entertainments);
  if (slotNodes.length === 0) {
    throw new Error(
      "[singaporegp] Found entertainments groups but 0 performance slots — shape changed"
    );
  }

  // --- Group slots by artist -------------------------------------------------
  const artists = new Map<string, Artist>();
  let skippedBadDate = 0;
  let skippedNoIdentity = 0;
  let skippedUnpublished = 0;

  for (const node of slotNodes) {
    const parent = node.parent_slug as Record<string, unknown>;

    const status = asString(node.status);
    if (status && status !== "published") {
      skippedUnpublished++;
      continue;
    }

    const date = asString(node.date);
    if (!date || !ISO_DATE.test(date)) {
      skippedBadDate++;
      console.warn(
        `[singaporegp] Skipping slot with unparseable date ${JSON.stringify(node.date)} ` +
          `(artist: ${JSON.stringify(parent.slug)})`
      );
      continue;
    }

    const slug = asString(parent.slug);
    const title = htmlToText(asString(parent.title));
    if (!slug || !title) {
      skippedNoIdentity++;
      console.warn(
        `[singaporegp] Skipping slot with no artist slug/title (slot ${JSON.stringify(node.slug)})`
      );
      continue;
    }

    const venueRecord = isRecord(node.venue) ? node.venue : null;
    const slot: Slot = {
      date,
      startTime: asString(node.start_time),
      endTime: asString(node.end_time),
      stage: venueRecord ? asString(venueRecord.name) : null,
    };

    const existing = artists.get(slug);
    if (existing) {
      existing.slots.push(slot);
      continue;
    }

    artists.set(slug, {
      slug,
      title,
      category: htmlToText(asString(parent.category)) || "Race weekend line-up",
      description:
        htmlToText(asString(parent.description)) ||
        htmlToText(asString(parent.short_description)) ||
        null,
      slots: [slot],
    });
  }

  // --- Race weekend dates ----------------------------------------------------
  // Prefer the page's own `dates` array; fall back to the span of every slot so a
  // CMS rename of that field doesn't lose the umbrella event.
  const declaredDates = Array.isArray(pageProps.dates)
    ? pageProps.dates
        .map((d) => (isRecord(d) ? asString(d.date) : null))
        .filter((d): d is string => d !== null && ISO_DATE.test(d))
    : [];
  const slotDates = [...artists.values()].flatMap((a) => a.slots.map((s) => s.date));
  const weekendDates = [...new Set(declaredDates.length > 0 ? declaredDates : slotDates)].sort();

  const events: SingaporegpEvent[] = [];
  let skippedPast = 0;
  let skippedCategory = 0;

  // --- 1. The race itself ----------------------------------------------------
  const futureWeekend = weekendDates.filter((d) => d >= todayIso);
  if (futureWeekend.length > 0) {
    const raceStart = futureWeekend[0];
    const raceEnd = futureWeekend[futureWeekend.length - 1];
    const season = new Date(`${raceEnd}T00:00:00`).getFullYear();
    const headliners = [...artists.values()]
      .filter((a) => /headlining/i.test(a.category))
      .filter((a) => a.slots.some((s) => s.date >= todayIso))
      .map((a) => a.title);

    const raceDescription = [
      `Formula 1's only night race, run under floodlights on the ${CIRCUIT} street track through downtown Singapore.`,
      `The ${formatRange(raceStart, raceEnd)} race weekend covers practice, qualifying and the Grand Prix itself.`,
      `A race ticket also admits you to the weekend's live music programme across stages inside the circuit park${
        headliners.length > 0 ? `, headlined by ${headliners.slice(0, 8).join(", ")}` : ""
      }.`,
    ].join(" ");

    events.push({
      source_url: RACE_URL,
      raw_title: `Formula 1 Singapore Airlines Singapore Grand Prix ${season}`,
      raw_description: raceDescription,
      venue: CIRCUIT,
      event_date_start: raceStart,
      event_date_end: raceEnd !== raceStart ? raceEnd : null,
    });
  } else if (weekendDates.length > 0) {
    console.warn(
      `[singaporegp] Race weekend ${weekendDates[0]}..${weekendDates[weekendDates.length - 1]} ` +
        `is in the past — page has not rolled over to next season yet`
    );
  }

  // --- 2. One event per artist ----------------------------------------------
  for (const artist of artists.values()) {
    if (SKIPPED_CATEGORIES.has(artist.category.toLowerCase())) {
      skippedCategory++;
      continue;
    }

    const upcoming = artist.slots
      .filter((s) => s.date >= todayIso)
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
    if (upcoming.length === 0) {
      skippedPast++;
      continue;
    }

    const start = upcoming[0].date;
    const end = upcoming[upcoming.length - 1].date;
    const season = new Date(`${end}T00:00:00`).getFullYear();
    const stage = upcoming.find((s) => s.stage !== null)?.stage ?? null;

    const weekendLabel =
      weekendDates.length > 0
        ? formatRange(weekendDates[0], weekendDates[weekendDates.length - 1])
        : formatRange(start, end);

    const description = [
      `${artist.category} on the entertainment line-up of the Formula 1 Singapore Airlines Singapore Grand Prix ${season} (${weekendLabel}).`,
      `Performing ${upcoming.map(formatSlot).join("; ")}.`,
      `Concert access is included with a Singapore GP race ticket.`,
      artist.description ?? "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000);

    events.push({
      source_url: `${ARTIST_URL_BASE}${artist.slug}/`,
      raw_title: `${artist.title} — Singapore GP ${season}`,
      raw_description: description,
      venue: buildVenue(stage),
      event_date_start: start,
      event_date_end: end !== start ? end : null,
    });
  }

  console.log(
    `[singaporegp] Parsed ${slotNodes.length} slots → ${artists.size} artists → ` +
      `${events.length} events (skipped: ${skippedCategory} roving, ${skippedPast} past, ` +
      `${skippedBadDate} bad date, ${skippedNoIdentity} no identity, ${skippedUnpublished} unpublished)`
  );

  if (events.length === 0) {
    console.warn(
      `[singaporegp] 0 events after filtering — every slot is before ${todayIso}. ` +
        `Expected right after the race, before the CMS rolls over to next season.`
    );
  }

  return events;
}

/** Fetch the line-up page. Throws on non-OK so the run is logged as an error. */
export async function fetchLineupPage(): Promise<string> {
  const res = await fetch(LISTING_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`[singaporegp] ${LISTING_URL} returned ${res.status}`);
  }
  // Log where the redirect landed — makes a season rollover visible in cron logs.
  console.log(`[singaporegp] Line-up page: ${res.url}`);
  return res.text();
}

export function getTodaySgt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

export async function scrapeSingaporegp(): Promise<number> {
  await initializeDb();

  const html = await fetchLineupPage();
  const events = parseLineup(html, getTodaySgt());

  let newEvents = 0;
  for (const event of events) {
    const result = await upsertEvent({ source: "singaporegp", ...event });
    if (result.inserted) newEvents++;
  }

  console.log(`[singaporegp] Scraped ${newEvents} new events`);
  return newEvents;
}
