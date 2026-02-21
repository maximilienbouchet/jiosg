import { NextRequest, NextResponse } from "next/server";

// POST /api/subscribe
export async function POST(_request: NextRequest) {
  // TODO: Accept { email }, add subscriber, return success
  return NextResponse.json({ success: false, message: "Not implemented" });
}
