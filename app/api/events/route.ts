import { NextRequest, NextResponse } from "next/server";
import { getPublishedEvents, getEventsByTag, initializeDb } from "../../../lib/db";
import { ALL_TAGS } from "../../../lib/tags";

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
// GET /api/events?tag=live+%26+loud&limit=20&offset=0
export async function GET(request: NextRequest) {
  const tag = request.nextUrl.searchParams.get("tag");

  await initializeDb();

  if (tag) {
    // Tag-based browsing mode
    if (!ALL_TAGS.includes(tag as typeof ALL_TAGS[number])) {
      return NextResponse.json({ error: "Invalid tag" }, { status: 400 });
    }

    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 20, 100);
    const offset = Number(request.nextUrl.searchParams.get("offset")) || 0;
    const todaySgt = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

    const rows = await getEventsByTag(tag, todaySgt, limit + 1, offset);
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const events = sliced.map((row) => ({
      id: row.id,
      title: row.raw_title,
      venue: row.venue,
      blurb: row.blurb || "",
      tags: row.tags ? JSON.parse(row.tags) : [],
      sourceUrl: row.source_url,
      eventDateStart: row.event_date_start,
      eventDateEnd: row.event_date_end,
    }));

    return NextResponse.json({ events, hasMore });
  }

  // Date range mode (existing behavior)
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "Missing start or end parameter" }, { status: 400 });
  }

  const rows = await getPublishedEvents(start, end);

  const events = rows.map((row) => ({
    id: row.id,
    title: row.raw_title,
    venue: row.venue,
    blurb: row.blurb || "",
    tags: row.tags ? JSON.parse(row.tags) : [],
    sourceUrl: row.source_url,
    eventDateStart: row.event_date_start,
    eventDateEnd: row.event_date_end,
  }));

  return NextResponse.json({ events });
}
