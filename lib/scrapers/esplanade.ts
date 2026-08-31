import { initializeDb, upsertEvent } from "../db";

// Esplanade migrated from Sitecore XM (the old /sitecore/api/website/event/listing
// endpoint, now HTTP 404) to Sitecore XM Cloud + Sitecore Search. The what's-on
// listing is now client-rendered and fed by this JSON search API.
const SEARCH_URL = "https://edge-platform.sitecorecloud.io/v1/search";
const SITE_URL = "https://www.esplanade.com";
const LISTING_URL = `${SITE_URL}/whats-on/all-events`;

// Baked into the site's Next.js _app bundle. If Esplanade redeploys with a new
// context id we rediscover it from the live page rather than failing outright.
const DEFAULT_CONTEXT_ID = "1PkquNc51VRGK9OcVwwYZu";
const WIDGET_ID = "rfkid_7";
const INGESTION_SOURCE = "_events_ingestion_source";

const PAGE_SIZE = 100; // API rejects limit > 100
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "SGEventsCuration/1.0";

// Events we should never recommend — no tickets left to buy.
const UNAVAILABLE_STATUSES = new Set(["Sold Out", "Fully Subscribed"]);

interface EsplanadeSearchItem {
  name?: string | null;
  description?: string | null;
  url?: string | null;
  event_venue?: string[] | null;
  event_category?: string[] | null;
  event_startdate?: string | null;
  event_enddate?: string | null;
  festival_name?: string | null;
  ticket_type?: string | null;
  production_status?: string | null;
  is_long_running?: boolean | null;
}

interface EsplanadeSearchResponse {
  widgets?: {
    content?: EsplanadeSearchItem[] | null;
    total_item?: number | null;
  }[];
  errors?: { message?: string; code?: number }[];
}

export interface EsplanadeEvent {
  sourceUrl: string;
  title: string;
  description: string | null;
  venue: string;
  startDate: string;
  endDate: string | null;
}

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function padDay(day: string): string {
  return day.padStart(2, "0");
}

/** Normalise an ISO date or datetime ("2026-09-05T18:45:00+08:00") to YYYY-MM-DD. */
function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Parse the legacy human-readable display strings the old Sitecore API returned,
 * e.g. "21 Feb 2026", "20 – 22 Feb 2026", "21 Feb – 15 Mar 2026".
 */
function parseTextualRange(
  text: string
): { startDate: string; endDate: string | null } | null {
  const trimmed = text.trim();

  // "21 Feb 2026" — single date
  const single = trimmed.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (single) {
    const [, day, mon, year] = single;
    const mm = MONTH_MAP[mon];
    if (mm) return { startDate: `${year}-${mm}-${padDay(day)}`, endDate: null };
  }

  // "20 – 22 Feb 2026" — same-month range
  const sameMonth = trimmed.match(
    /^(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+(\w{3})\s+(\d{4})$/
  );
  if (sameMonth) {
    const [, startDay, endDay, mon, year] = sameMonth;
    const mm = MONTH_MAP[mon];
    if (mm) {
      return {
        startDate: `${year}-${mm}-${padDay(startDay)}`,
        endDate: `${year}-${mm}-${padDay(endDay)}`,
      };
    }
  }

  // "21 Feb – 15 Mar 2026" — cross-month range
  const crossMonth = trimmed.match(
    /^(\d{1,2})\s+(\w{3})\s*[–—-]\s*(\d{1,2})\s+(\w{3})\s+(\d{4})$/
  );
  if (crossMonth) {
    const [, startDay, startMon, endDay, endMon, year] = crossMonth;
    const smm = MONTH_MAP[startMon];
    const emm = MONTH_MAP[endMon];
    if (smm && emm) {
      return {
        startDate: `${year}-${smm}-${padDay(startDay)}`,
        endDate: `${year}-${emm}-${padDay(endDay)}`,
      };
    }
  }

  return null;
}

/**
 * Resolve an event's run dates to ISO YYYY-MM-DD.
 *
 * The current Sitecore Search API returns `event_startdate` / `event_enddate`
 * already in ISO form, so those are used directly. The legacy textual formats
 * ("21 Feb – 15 Mar 2026") are still accepted so a display-date string passed as
 * `startRaw` keeps parsing the way it always did.
 *
 * `endDate` is null for single-day events.
 */
export function parseDisplayDate(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined
): { startDate: string | null; endDate: string | null } {
  const isoEnd = normalizeIsoDate(endRaw);
  const isoStart = normalizeIsoDate(startRaw);

  if (isoStart) {
    return { startDate: isoStart, endDate: isoEnd && isoEnd > isoStart ? isoEnd : null };
  }

  if (startRaw) {
    const textual = parseTextualRange(startRaw);
    if (textual) {
      const end = textual.endDate ?? isoEnd;
      return {
        startDate: textual.startDate,
        endDate: end && end > textual.startDate ? end : null,
      };
    }
    console.warn(`[esplanade] Could not parse date "${startRaw}"`);
  }

  return { startDate: null, endDate: null };
}

function buildPayload(offset: number, nowSeconds: number) {
  return {
    context: { locale: { country: "us", language: "en" } },
    widget: {
      items: [
        {
          entity: "itementity",
          rfk_id: WIDGET_ID,
          sources: [INGESTION_SOURCE],
          search: {
            offset,
            limit: PAGE_SIZE,
            sort: { value: [{ name: "event_start_datetime_ascending" }] },
            filter: {
              type: "and",
              filters: [
                { name: "type", type: "eq", value: "Event" },
                // Keep anything still running as well as future events.
                {
                  name: "event_end_datetime",
                  type: "gte",
                  value: String(nowSeconds),
                },
              ],
            },
            content: {},
          },
        },
      ],
    },
  };
}

async function requestPage(
  contextId: string,
  offset: number,
  nowSeconds: number
): Promise<{ ok: boolean; status: number; body: EsplanadeSearchResponse | null }> {
  const url = `${SEARCH_URL}?sitecoreContextId=${encodeURIComponent(contextId)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(buildPayload(offset, nowSeconds)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let body: EsplanadeSearchResponse | null = null;
  try {
    body = (await response.json()) as EsplanadeSearchResponse;
  } catch {
    body = null;
  }

  const hasErrors = Boolean(body?.errors?.length);
  return { ok: response.ok && !hasErrors, status: response.status, body };
}

/**
 * Recover the Sitecore context id from the live site if the hardcoded one stops
 * working (Esplanade rebuilds bake a new id into the Next.js _app bundle).
 */
async function discoverContextId(): Promise<string | null> {
  try {
    const pageRes = await fetch(LISTING_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const chunkMatch = html.match(
      /src="(\/_next\/static\/chunks\/pages\/_app-[^"]+)"/
    );
    if (!chunkMatch) return null;

    const chunkUrl = new URL(chunkMatch[1].replace(/&amp;/g, "&"), SITE_URL).href;
    const chunkRes = await fetch(chunkUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!chunkRes.ok) return null;

    const js = await chunkRes.text();
    const idMatch = js.match(/clientContextId:[^|]*\|\|\s*"([A-Za-z0-9_-]{10,})"/);
    return idMatch ? idMatch[1] : null;
  } catch (err) {
    console.warn("[esplanade] Context id discovery failed:", err);
    return null;
  }
}

function todayInSingapore(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildDescription(item: EsplanadeSearchItem): string | null {
  const categories = (item.event_category ?? []).filter(Boolean);
  const parts = [
    item.description?.trim() || null,
    item.festival_name ? `Part of ${item.festival_name}` : null,
    categories.length > 0 ? categories.join(", ") : null,
    item.ticket_type === "Free" ? "Free admission" : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * Fetch and parse every upcoming Esplanade event.
 *
 * The search index holds one row per performance time, so rows are collapsed by
 * event page URL. Throws on any structural failure (bad HTTP status, API errors,
 * or an empty index) so breakage surfaces instead of silently returning nothing.
 */
export async function fetchEsplanadeEvents(): Promise<EsplanadeEvent[]> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const today = todayInSingapore();

  let contextId = DEFAULT_CONTEXT_ID;
  let first = await requestPage(contextId, 0, nowSeconds);

  // The baked-in context id may have rotated — rediscover it once before failing.
  if (!first.ok) {
    console.warn(
      `[esplanade] Search API rejected context id ${contextId} (HTTP ${first.status}), attempting rediscovery`
    );
    const discovered = await discoverContextId();
    if (!discovered) {
      throw new Error(
        `Esplanade search API failed (HTTP ${first.status}) and context id could not be rediscovered from ${LISTING_URL}`
      );
    }
    if (discovered !== contextId) {
      console.warn(`[esplanade] Retrying with rediscovered context id ${discovered}`);
      contextId = discovered;
      first = await requestPage(contextId, 0, nowSeconds);
    }
    if (!first.ok) {
      throw new Error(
        `Esplanade search API failed (HTTP ${first.status}) even with rediscovered context id ${contextId}`
      );
    }
  }

  const firstWidget = first.body?.widgets?.[0];
  if (!firstWidget || !Array.isArray(firstWidget.content)) {
    throw new Error(
      "Esplanade search API returned an unexpected shape — no widgets[0].content array"
    );
  }

  const totalItems = firstWidget.total_item ?? 0;
  if (totalItems === 0 || firstWidget.content.length === 0) {
    // Esplanade always has dozens of concurrent listings. Zero means the query
    // (widget id / ingestion source / filter names) no longer matches the index.
    throw new Error(
      `Esplanade search API returned 0 events (total_item=${totalItems}) — the widget "${WIDGET_ID}" or source "${INGESTION_SOURCE}" has likely changed`
    );
  }

  const rows: EsplanadeSearchItem[] = [...firstWidget.content];
  const totalPages = Math.min(Math.ceil(totalItems / PAGE_SIZE), MAX_PAGES);

  for (let page = 1; page < totalPages; page++) {
    const result = await requestPage(contextId, page * PAGE_SIZE, nowSeconds);
    if (!result.ok) {
      throw new Error(
        `Esplanade search API failed on page ${page + 1} (HTTP ${result.status})`
      );
    }
    const content = result.body?.widgets?.[0]?.content;
    if (!Array.isArray(content)) {
      throw new Error(
        `Esplanade search API returned an unexpected shape on page ${page + 1}`
      );
    }
    if (content.length === 0) break;
    rows.push(...content);
  }

  console.log(
    `[esplanade] Fetched ${rows.length} performance rows (total_item=${totalItems})`
  );

  const byUrl = new Map<string, EsplanadeEvent>();
  let skipped = 0;

  for (const item of rows) {
    if (!item.url || !item.name) {
      skipped++;
      continue;
    }

    if (item.production_status && UNAVAILABLE_STATUSES.has(item.production_status)) {
      continue;
    }

    const sourceUrl = new URL(item.url, SITE_URL).href;
    if (byUrl.has(sourceUrl)) continue; // extra performance of an event we have

    const { startDate, endDate } = parseDisplayDate(
      item.event_startdate,
      item.event_enddate
    );
    if (!startDate) {
      console.warn(`[esplanade] Skipping "${item.name}" — no parseable date`);
      skipped++;
      continue;
    }

    // Belt-and-braces: the API filter should already exclude finished runs.
    if ((endDate ?? startDate) < today) continue;

    const venue = (item.event_venue ?? []).filter(Boolean).join(", ") || "Esplanade";

    byUrl.set(sourceUrl, {
      sourceUrl,
      title: item.name.trim(),
      description: buildDescription(item),
      venue,
      startDate,
      endDate,
    });
  }

  const events = [...byUrl.values()];

  if (events.length === 0) {
    throw new Error(
      `Esplanade returned ${rows.length} rows but none could be parsed into events`
    );
  }

  if (skipped > 0) {
    console.warn(`[esplanade] Skipped ${skipped} unparseable rows`);
  }

  return events;
}

export async function scrapeEsplanade(): Promise<number> {
  await initializeDb();

  const events = await fetchEsplanadeEvents();
  console.log(`[esplanade] Parsed ${events.length} unique events`);

  let newEvents = 0;
  for (const event of events) {
    const result = await upsertEvent({
      source: "esplanade",
      source_url: event.sourceUrl,
      raw_title: event.title,
      raw_description: event.description,
      venue: event.venue,
      event_date_start: event.startDate,
      event_date_end: event.endDate,
    });
    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[esplanade] Scraped ${newEvents} new events`);
  return newEvents;
}
