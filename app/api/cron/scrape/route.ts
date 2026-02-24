import { NextRequest, NextResponse } from "next/server";
import { runAllScrapers } from "../../../../lib/scrapers";
import { initializeDb, insertScraperRun } from "../../../../lib/db";
import { sendScraperAlertEmail } from "../../../../lib/email";

export const maxDuration = 300;

const ALL_SOURCES = ["thekallang", "eventbrite", "esplanade", "sportplus", "peatix", "fever", "tessera"];

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

  // Log runs to scraper_runs table
  await initializeDb();
  for (const source of ALL_SOURCES) {
    if (source in errors) {
      await insertScraperRun({ source, events_found: 0, error: errors[source] });
    } else {
      await insertScraperRun({ source, events_found: bySource[source] ?? 0, error: null });
    }
  }

  // Check for issues and send alert if needed
  const zeroSources = ALL_SOURCES.filter(
    (s) => !(s in errors) && (bySource[s] ?? 0) === 0
  );
  const hasIssues = zeroSources.length > 0 || Object.keys(errors).length > 0;

  let alert = null;
  if (hasIssues) {
    alert = await sendScraperAlertEmail({
      zeroSources,
      errorSources: errors,
      bySource,
    });
  }

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
    alert,
  });
}
