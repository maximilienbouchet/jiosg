import { NextRequest, NextResponse } from "next/server";

// POST /api/cron/email — trigger weekly email digest (called by external cron)
export async function POST(_request: NextRequest) {
  // TODO: Verify CRON_SECRET, send digest email to all active subscribers
  return NextResponse.json({ success: false, message: "Not implemented" });
}
