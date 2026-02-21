import { NextRequest, NextResponse } from "next/server";

// POST /api/admin/process-url — paste URL → fetch content → LLM generates blurb + tags
export async function POST(_request: NextRequest) {
  // TODO: Verify admin password, fetch URL content, run LLM filter + blurb, return preview
  return NextResponse.json({ success: false, message: "Not implemented" });
}
