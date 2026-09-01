import * as cheerio from "cheerio";
import { initializeDb, upsertEvent } from "../db";

// ActiveSG Circle is Sport Singapore's public events calendar: races, runs,
// mass-participation challenges, national competitions and sports festivals.
// It fills jio's biggest coverage gap (participatory + grassroots-spectator
// sport). Note: the F1 Grand Prix is NOT here — it isn't an ActiveSG event.
//
// The listing page (https://www.activesgcircle.gov.sg/things-to-do/events) is
// client-rendered on top of a HubSpot serverless function. The endpoint name is
// typo'd upstream ("evnetsCalendarData"); if a site refresh renames it this
// scraper throws on the non-OK response and scraper-health alerting fires.
const API_URL = "https://www.activesgcircle.gov.sg/_hcms/api/evnetsCalendarData";
const EVENT_BASE = "https://www.activesgcircle.gov.sg/things-to-do/events";
const USER_AGENT = "SGEventsCuration/1.0";

// One POST per calendar month: the API returns every event overlapping the
// month given. Current month + next 2 ≈ 15s, comfortably inside the cron budget.
const MONTHS_TO_FETCH = 3;
// The endpoint answers in 4-7s. Requests are sequential and the orchestrator
// kills any scraper at 50s, so keep the worst case (3 x timeout) under that.
const REQUEST_TIMEOUT_MS = 15_000;
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_DESCRIPTION_CHARS = 1500;

// Coach-education programming — professional CPD, not events for jio's audience.
const SKIPPED_FILTER_TYPES = new Set(["workshop", "conference"]);
const COACHSG_TAG = "coachsg";

interface ActivesgProperties {
  event_title?: string | null;
  description_short?: string | null;
  description_long?: string | null;
  venue?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  fees?: string | null;
  filter_type?: string | null;
  filter_group?: string | null;
  tags?: string | null;
  event_path?: string | null;
  registration_url?: string | null;
  redirect_to_website?: string | null;
  published?: string | boolean | null;
}

export interface ActivesgRow {
  id?: string;
  properties?: ActivesgProperties;
}

export interface ParsedActivesgEvent {
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
}

export type RowOutcome =
  | { kind: "event"; event: ParsedActivesgEvent }
  // Deliberate editorial/structural exclusions — expected, logged as a tally.
  | { kind: "skipped"; reason: string }
  // Something we expected to parse and could not — always logged individually.
  | { kind: "unparsed"; reason: string; label: string };

/** ISO date (YYYY-MM-DD) of "now" in Singapore time. */
export function sgtDate(instant: Date): string {
  return new Date(instant.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Source timestamps are real UTC instants: date-only rows come through as
 * midnight UTC (same SGT calendar day) while timed rows carry the real hour
 * (e.g. a 9am SGT workshop is 01:00Z). Shifting to SGT before taking the date
 * part is therefore correct for both, and avoids an early-morning race landing
 * on the previous day.
 */
export function toSgtDatePart(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return sgtDate(new Date(ts));
}

/**
 * Month keys the API expects: ms-epoch of the 1st of the month at midnight UTC,
 * as a string. Anchored on the SGT calendar so the 3am SGT cron (still the
 * previous day in UTC) doesn't query a month behind.
 */
export function monthKeys(instant: Date, count = MONTHS_TO_FETCH): string[] {
  const [year, month] = sgtDate(instant).split("-").map(Number);
  return Array.from({ length: count }, (_, i) =>
    String(Date.UTC(year, month - 1 + i, 1)),
  );
}

function splitTags(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** HubSpot rich text → plain text, keeping block boundaries as spaces. */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("br").replaceWith(" ");
  $("p, div, li, tr, h1, h2, h3, h4, h5, h6").after(" ");
  return $.root().text().replace(/\s+/g, " ").trim();
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildDescription(props: ActivesgProperties): string | null {
  const short = normalise(props.description_short);
  const long = props.description_long ? htmlToText(props.description_long) : "";
  // The short blurb is usually the first line of the long one; don't repeat it.
  const body = long.startsWith(short) ? long : [short, long].filter(Boolean).join(" ");

  const meta: string[] = [];
  const filterType = normalise(props.filter_type);
  if (filterType) meta.push(`Event type: ${filterType}`);
  const fees = normalise(props.fees);
  if (fees) meta.push(`Fees: ${/^0(\.0+)?$/.test(fees) ? "Free" : fees}`);

  const description = [body.slice(0, MAX_DESCRIPTION_CHARS), meta.join(" · ")]
    .filter(Boolean)
    .join(" — ");
  return description || null;
}

function buildSourceUrl(props: ActivesgProperties): string | null {
  // Some listings are hosted by the organiser; ActiveSG then only bounces to
  // them, so link the real page (and give cross-source dedup a chance to match).
  const registrationUrl = normalise(props.registration_url);
  const redirects = String(props.redirect_to_website ?? "").toLowerCase() === "true";
  if (redirects && /^https?:\/\//i.test(registrationUrl)) return registrationUrl;

  // CoachSG rows live on a different host, but they're filtered out upstream.
  const path = normalise(props.event_path);
  return path ? `${EVENT_BASE}/${path}` : null;
}

export function parseRow(row: ActivesgRow): RowOutcome {
  const props = row.properties;
  if (!props) return { kind: "unparsed", reason: "row has no properties", label: row.id ?? "?" };

  const title = normalise(props.event_title);
  const label = title || `id ${row.id ?? "?"}`;

  if (String(props.published ?? "").toLowerCase() !== "true") {
    return { kind: "skipped", reason: "unpublished" };
  }
  if (SKIPPED_FILTER_TYPES.has(normalise(props.filter_type).toLowerCase())) {
    return { kind: "skipped", reason: "coach-education (workshop/conference)" };
  }
  if (splitTags(props.tags).some((tag) => tag.toLowerCase() === COACHSG_TAG)) {
    return { kind: "skipped", reason: "CoachSG programme" };
  }

  if (!title) return { kind: "unparsed", reason: "missing event_title", label };

  const sourceUrl = buildSourceUrl(props);
  if (!sourceUrl) return { kind: "unparsed", reason: "no event_path or registration URL", label };

  const start = toSgtDatePart(props.start_date);
  if (!start) {
    return { kind: "unparsed", reason: `unparseable start_date ${JSON.stringify(props.start_date)}`, label };
  }
  const end = toSgtDatePart(props.end_date);
  if (props.end_date && !end) {
    return { kind: "unparsed", reason: `unparseable end_date ${JSON.stringify(props.end_date)}`, label };
  }

  return {
    kind: "event",
    event: {
      source_url: sourceUrl,
      raw_title: title,
      raw_description: buildDescription(props),
      venue: normalise(props.venue) || "Singapore",
      event_date_start: start,
      event_date_end: end && end !== start ? end : null,
    },
  };
}

async function fetchMonth(monthKey: string): Promise<ActivesgRow[]> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ date: monthKey, filter: "All", type: "All", search: "" }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`[activesg] API returned ${response.status} for month key ${monthKey}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      `[activesg] Expected an array for month key ${monthKey}, got ${typeof payload} — API contract changed`,
    );
  }
  return payload as ActivesgRow[];
}

export interface ActivesgCollection {
  events: ParsedActivesgEvent[];
  rowCount: number;
  duplicateRows: number;
  skipped: Record<string, number>;
  unparsed: string[];
}

/**
 * Fetch + parse only, no database access — shared by the scraper and the probe.
 * Throws on anything that looks like a broken contract rather than returning
 * an empty list: a silent zero is how a dead scraper hides for months.
 */
export async function collectActivesgEvents(instant = new Date()): Promise<ActivesgCollection> {
  const todayIso = sgtDate(instant);
  const byUrl = new Map<string, ParsedActivesgEvent>();
  const skipped: Record<string, number> = {};
  const unparsed: string[] = [];
  let rowCount = 0;
  let duplicateRows = 0;
  let candidates = 0;

  for (const monthKey of monthKeys(instant)) {
    const rows = await fetchMonth(monthKey);
    rowCount += rows.length;

    for (const row of rows) {
      const outcome = parseRow(row);

      if (outcome.kind === "skipped") {
        skipped[outcome.reason] = (skipped[outcome.reason] ?? 0) + 1;
        continue;
      }

      // Past the deliberate filters: from here on we expect a usable event.
      candidates++;

      if (outcome.kind === "unparsed") {
        unparsed.push(`${outcome.label} — ${outcome.reason}`);
        continue;
      }

      const event = outcome.event;
      // Ongoing multi-month events repeat across month calls.
      if (byUrl.has(event.source_url)) {
        duplicateRows++;
        continue;
      }
      // Long-running events legitimately start in the past; drop only those
      // that have finished.
      if ((event.event_date_end ?? event.event_date_start) < todayIso) {
        skipped.past = (skipped.past ?? 0) + 1;
        continue;
      }
      byUrl.set(event.source_url, event);
    }
  }

  if (rowCount === 0) {
    throw new Error("[activesg] API returned 0 rows across all months — endpoint or contract changed");
  }
  if (candidates > 0 && byUrl.size === 0 && unparsed.length > 0) {
    throw new Error(
      `[activesg] ${candidates} candidate rows but parsed 0 events — field mapping broke: ${unparsed.slice(0, 3).join("; ")}`,
    );
  }

  return { events: [...byUrl.values()], rowCount, duplicateRows, skipped, unparsed };
}

export async function scrapeActivesg(): Promise<number> {
  await initializeDb();

  const { events, rowCount, duplicateRows, skipped, unparsed } = await collectActivesgEvents();

  for (const line of unparsed) {
    console.warn(`[activesg] Skipped unparseable row: ${line}`);
  }

  let newEvents = 0;
  for (const event of events) {
    const result = await upsertEvent({ source: "activesg", ...event });
    if (result.inserted) newEvents++;
  }

  const skippedSummary = Object.entries(skipped)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(", ");
  console.log(
    `[activesg] ${rowCount} rows over ${MONTHS_TO_FETCH} months ` +
      `(${duplicateRows} repeat rows, skipped — ${skippedSummary || "none"}, ` +
      `${unparsed.length} unparseable), ${events.length} upcoming events, ${newEvents} new`,
  );
  return newEvents;
}
