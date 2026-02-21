import { NextRequest, NextResponse } from "next/server";

// GET /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(_request: NextRequest) {
  // TODO: Query published events within date range, return as JSON
  return NextResponse.json({ events: [], message: "Not implemented" });
}

// POST /api/events (thumbs up/down)
export async function POST(_request: NextRequest) {
  // TODO: Accept { eventId, vote: "up" | "down" }, increment counter
  return NextResponse.json({ success: false, message: "Not implemented" });
}
