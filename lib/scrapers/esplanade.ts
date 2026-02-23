import { initializeDb, upsertEvent } from "../db";

const API_URL =
  "https://www.esplanade.com/sitecore/api/website/event/listing/view-by-event";
const PARENT_ID = "d3a2e2b2054f4374b469a678b9405d13";
const DATASOURCE_ID = "1ca038b825df4b49ac3afcaf7889777d";
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const USER_AGENT = "SGEventsCuration/1.0";

interface EsplanadeListing {
  PageData: { Title: string; Description: string; Url: string } | null;
  Genres: string[] | null;
  DisplayDate: string | null;
  Venue: string | null;
  PerformerName: string | null;
  PerformanceStartDate: string | null;
  PerformanceEndDate: string | null;
  IsPastEvent: boolean;
  IsLiveStreamEvent: boolean;
  IsOnDemandEvent: boolean;
}

interface EsplanadeResponse {
  Listings: EsplanadeListing[];
  Pagination: {
    TotalRecord: number;
    TotalPage: number;
    PageSize: number;
    CurrentPageNumber: number;
  };
}

const MONTH_MAP: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04",
  May: "05", Jun: "06", Jul: "07", Aug: "08",
  Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function padDay(day: string): string {
  return day.padStart(2, "0");
}

export function parseDisplayDate(
  displayDate: string | null,
  fallbackStart: string | null
): { startDate: string | null; endDate: string | null } {
  if (!displayDate) {
    const fallback = fallbackStart?.slice(0, 10) ?? null;
    return { startDate: fallback, endDate: null };
  }

  const trimmed = displayDate.trim();

  // Format: "21 Feb 2026" — single date
  const single = trimmed.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (single) {
    const [, day, mon, year] = single;
    const mm = MONTH_MAP[mon];
    if (mm) {
      return { startDate: `${year}-${mm}-${padDay(day)}`, endDate: null };
    }
  }

  // Format: "20 – 22 Feb 2026" — same-month range (day – day Month Year)
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

  // Format: "21 Feb – 15 Mar 2026" — cross-month range
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

  // Fallback to PerformanceStartDate
  const fallback = fallbackStart?.slice(0, 10) ?? null;
  if (fallback) {
    console.warn(
      `[esplanade] Could not parse DisplayDate "${displayDate}", using fallback`
    );
  }
  return { startDate: fallback, endDate: null };
}

export async function scrapeEsplanade(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const params = new URLSearchParams({
      languages: "en",
      pageSize: String(PAGE_SIZE),
      pageNumber: String(pageNumber),
      parentId: PARENT_ID,
      datasourceId: DATASOURCE_ID,
      eventType: "ongoing",
    });

    let data: EsplanadeResponse;
    try {
      const response = await fetch(`${API_URL}?${params}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        console.warn(
          `[esplanade] API returned ${response.status}, stopping pagination`
        );
        break;
      }
      data = await response.json();
    } catch (err) {
      console.warn(`[esplanade] Fetch failed for page ${pageNumber}:`, err);
      break;
    }

    if (!data.Listings || data.Listings.length === 0) {
      break;
    }

    for (const listing of data.Listings) {
      if (listing.IsPastEvent) continue;
      if (listing.IsLiveStreamEvent) continue;
      if (listing.IsOnDemandEvent) continue;

      if (!listing.PageData?.Title || !listing.Venue) {
        console.warn(
          `[esplanade] Skipping listing with missing title or venue`
        );
        continue;
      }

      const { startDate, endDate } = parseDisplayDate(
        listing.DisplayDate,
        listing.PerformanceStartDate
      );

      if (!startDate) {
        console.warn(
          `[esplanade] Skipping "${listing.PageData.Title}" — no parseable date`
        );
        continue;
      }

      const sourceUrl = new URL(
        listing.PageData.Url,
        "https://www.esplanade.com"
      ).href;

      const descParts = [
        listing.PageData.Description,
        listing.PerformerName,
        listing.Genres?.join(", "),
      ].filter(Boolean);
      const rawDescription = descParts.length > 0 ? descParts.join(" | ") : null;

      const result = await upsertEvent({
        source: "esplanade",
        source_url: sourceUrl,
        raw_title: listing.PageData.Title,
        raw_description: rawDescription,
        venue: listing.Venue,
        event_date_start: startDate,
        event_date_end: endDate,
      });

      if (result.inserted) {
        newEvents++;
      }
    }

    if (pageNumber >= data.Pagination.TotalPage) {
      break;
    }
  }

  console.log(`[esplanade] Scraped ${newEvents} new events`);
  return newEvents;
}
