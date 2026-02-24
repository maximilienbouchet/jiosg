import { initializeDb, checkEventExists, upsertEvent } from "../db";

const LISTING_URL = "https://feverup.com/api/4.1/plans/best/SIN/?page=1&offset=200";
const USER_AGENT = "SGEventsCuration/1.0";
const DETAIL_DELAY_MS = 300;

interface FeverPlan {
  id: number;
  plan_id?: number;
  name: string;
  slug?: string;
  date_from?: string | null;
  date_to?: string | null;
  first_active_session_date?: string | null;
  last_active_session_date?: string | null;
  venue_name?: string | null;
  place?: { id?: number; name?: string };
  is_sold_out?: boolean;
  sold_out?: boolean;
  extra?: {
    timeless?: boolean;
  };
}

interface FeverDetailResponse {
  meta?: {
    description?: string;
  };
  venue_name?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toDateString(dt: string | null): string | null {
  if (!dt) return null;
  const match = dt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export async function scrapeFever(): Promise<number> {
  await initializeDb();
  let newEvents = 0;

  let plans: FeverPlan[];
  try {
    const response = await fetch(LISTING_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "X-Platform": "web",
        "X-Brand": "fever",
      },
    });
    if (!response.ok) {
      throw new Error(`Listing API returned ${response.status}`);
    }
    const data = await response.json();
    plans = data.plans || data.results || [];
  } catch (err) {
    console.error("[fever] Failed to fetch listing:", err);
    throw err;
  }

  console.log(`[fever] Found ${plans.length} plans in listing`);

  for (const plan of plans) {
    // Pre-filter
    if (plan.name && /gift\s*card/i.test(plan.name)) continue;
    if (plan.extra?.timeless) continue;
    if (plan.sold_out || plan.is_sold_out) continue;

    const planId = plan.plan_id || plan.id;
    const sourceUrl = `https://feverup.com/m/${planId}`;
    const startDate = toDateString(plan.date_from || plan.first_active_session_date || null);
    if (!startDate) continue;

    // Skip if already in DB
    if (await checkEventExists(sourceUrl)) continue;

    // Fetch detail for description
    let description: string | null = null;
    let venue = plan.venue_name || plan.place?.name || "Singapore";
    try {
      await sleep(DETAIL_DELAY_MS);
      const detailRes = await fetch(`https://feverup.com/api/4.1/plans/${planId}/`, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json",
          "X-Platform": "web",
          "X-Brand": "fever",
        },
      });
      if (detailRes.ok) {
        const detail: FeverDetailResponse = await detailRes.json();
        description = detail.meta?.description || null;
        if (detail.venue_name) {
          venue = detail.venue_name;
        }
      }
    } catch (err) {
      console.warn(`[fever] Failed to fetch detail for plan ${planId}:`, err);
    }

    const endDate = toDateString(plan.date_to || plan.last_active_session_date || null);

    const result = await upsertEvent({
      source: "fever",
      source_url: sourceUrl,
      raw_title: plan.name,
      raw_description: description,
      venue,
      event_date_start: startDate,
      event_date_end: endDate && endDate !== startDate ? endDate : null,
    });

    if (result.inserted) {
      newEvents++;
    }
  }

  console.log(`[fever] Scraped ${newEvents} new events`);
  return newEvents;
}
