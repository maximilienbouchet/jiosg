import { NextRequest, NextResponse } from "next/server";
import { getPublishedEvents, incrementThumbs, initializeDb } from "../../../lib/db";

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "Missing start or end parameter" }, { status: 400 });
  }

  initializeDb();
  const rows = getPublishedEvents(start, end);

  const events = rows.map((row) => ({
    id: row.id,
    title: row.raw_title,
    venue: row.venue,
    blurb: row.blurb || "",
    tags: row.tags ? JSON.parse(row.tags) : [],
    sourceUrl: row.source_url,
    eventDateStart: row.event_date_start,
    thumbsUp: row.thumbs_up,
    thumbsDown: row.thumbs_down,
  }));

  return NextResponse.json({ events });
}

// POST /api/events (thumbs up/down)
export async function POST(request: NextRequest) {
  let body: { eventId?: string; vote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, vote } = body;
  if (!eventId || (vote !== "up" && vote !== "down")) {
    return NextResponse.json({ error: "Invalid eventId or vote" }, { status: 400 });
  }

  initializeDb();
  const success = incrementThumbs(eventId, vote);
  return NextResponse.json({ success });
}
