import { NextRequest, NextResponse } from "next/server";

// GET /api/admin/events — list all events (scraped + manual) for moderation
export async function GET(_request: NextRequest) {
  // TODO: Verify admin password, return all events with moderation info
  return NextResponse.json({ events: [], message: "Not implemented" });
}

// POST /api/admin/events — create/update event
export async function POST(_request: NextRequest) {
  // TODO: Verify admin password, create or update event, toggle publish status
  return NextResponse.json({ success: false, message: "Not implemented" });
}
