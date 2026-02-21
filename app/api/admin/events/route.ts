import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/admin-auth";
import { initializeDb, getAllEvents, insertEvent, updateEvent } from "../../../../lib/db";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return unauthorized();

  initializeDb();
  const events = getAllEvents();

  const mapped = events.map((e) => ({
    id: e.id,
    source: e.source,
    sourceUrl: e.source_url,
    rawTitle: e.raw_title,
    rawDescription: e.raw_description,
    venue: e.venue,
    eventDateStart: e.event_date_start,
    eventDateEnd: e.event_date_end,
    scrapedAt: e.scraped_at,
    llmIncluded: e.llm_included,
    llmFilterReason: e.llm_filter_reason,
    blurb: e.blurb,
    tags: e.tags ? JSON.parse(e.tags) : [],
    isManuallyAdded: e.is_manually_added,
    isPublished: e.is_published,
    isHeadsUp: e.is_heads_up,
    thumbsUp: e.thumbs_up,
    thumbsDown: e.thumbs_down,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  }));

  return NextResponse.json({ events: mapped });
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return unauthorized();

  try {
    const body = await request.json();
    const { sourceUrl, rawTitle, rawDescription, venue, eventDateStart, eventDateEnd, blurb, tags, isHeadsUp } = body;

    if (!sourceUrl || !rawTitle || !venue || !eventDateStart) {
      return NextResponse.json(
        { message: "Missing required fields: sourceUrl, rawTitle, venue, eventDateStart" },
        { status: 400 }
      );
    }

    initializeDb();

    try {
      insertEvent({
        id: crypto.randomUUID(),
        source: "manual",
        source_url: sourceUrl,
        raw_title: rawTitle,
        raw_description: rawDescription || null,
        venue,
        event_date_start: eventDateStart,
        event_date_end: eventDateEnd || null,
        llm_included: 1,
        llm_filter_reason: "Manually added by admin",
        blurb: blurb || null,
        tags: tags ? JSON.stringify(tags) : null,
        is_manually_added: 1,
        is_published: 1,
        is_heads_up: isHeadsUp ? 1 : 0,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        return NextResponse.json(
          { message: "Event with this URL already exists" },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { message: "Invalid request body" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return unauthorized();

  try {
    const { id, data } = await request.json();

    if (!id || !data) {
      return NextResponse.json(
        { message: "Missing required fields: id, data" },
        { status: 400 }
      );
    }

    initializeDb();
    const updated = updateEvent(id, data);

    if (!updated) {
      return NextResponse.json(
        { message: "Event not found or no valid fields to update" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { message: "Invalid request body" },
      { status: 400 }
    );
  }
}
