import { NextRequest, NextResponse } from "next/server";

// POST /api/cron/scrape — trigger all scrapers (called by external cron)
export async function POST(_request: NextRequest) {
  // TODO: Verify CRON_SECRET, run all scrapers, return summary
  return NextResponse.json({ success: false, message: "Not implemented" });
}
