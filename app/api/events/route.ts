import { NextRequest, NextResponse } from "next/server";
import { getPublishedEvents, adjustThumbs, initializeDb } from "../../../lib/db";

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "Missing start or end parameter" }, { status: 400 });
  }

  await initializeDb();
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
    thumbsUp: row.thumbs_up,
    thumbsDown: row.thumbs_down,
  }));

  return NextResponse.json({ events });
}

// POST /api/events (thumbs up/down — toggleable)
export async function POST(request: NextRequest) {
  let body: { eventId?: string; vote?: string; previousVote?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, vote } = body;
  if (!eventId || (vote !== "up" && vote !== "down")) {
    return NextResponse.json({ error: "Invalid eventId or vote" }, { status: 400 });
  }

  const previousVote = body.previousVote;
  if (previousVote !== undefined && previousVote !== null && previousVote !== "up" && previousVote !== "down") {
    return NextResponse.json({ error: "Invalid previousVote" }, { status: 400 });
  }

  let upDelta = 0;
  let downDelta = 0;

  if (previousVote === vote) {
    // Undo: clicking the same direction again
    if (vote === "up") upDelta = -1;
    else downDelta = -1;
  } else if (previousVote === null || previousVote === undefined) {
    // New vote
    if (vote === "up") upDelta = 1;
    else downDelta = 1;
  } else {
    // Switch direction
    if (vote === "up") { upDelta = 1; downDelta = -1; }
    else { upDelta = -1; downDelta = 1; }
  }

  await initializeDb();
  const success = await adjustThumbs(eventId, upDelta, downDelta);
  return NextResponse.json({ success });
}
