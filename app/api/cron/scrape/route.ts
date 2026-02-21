import { NextRequest, NextResponse } from "next/server";
import { runAllScrapers } from "../../../../lib/scrapers";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, message: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  const { total, bySource, errors } = await runAllScrapers();

  const hasErrors = Object.keys(errors).length > 0;
  const message = hasErrors
    ? `Scraped ${total} new events with ${Object.keys(errors).length} error(s)`
    : `Scraped ${total} new events`;

  return NextResponse.json({
    success: !hasErrors,
    total,
    bySource,
    errors,
    message,
  });
}
