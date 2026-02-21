import { NextResponse } from "next/server";
import { getHeadsUpEvents, initializeDb } from "../../../../lib/db";

// GET /api/events/heads-up
// Returns up to 3 LLM-flagged notable events beyond the 7-day window
export async function GET() {
  const todaySgt = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

  initializeDb();
  const rows = getHeadsUpEvents(todaySgt);

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
