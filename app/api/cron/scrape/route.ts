import { NextRequest, NextResponse } from "next/server";
import { runAllScrapers } from "../../../../lib/scrapers";
import { initializeDb, insertScraperRun } from "../../../../lib/db";
import { sendPipelineReportEmail } from "../../../../lib/email";
import { verifyCronAuth } from "../../../../lib/cron-auth";

export const maxDuration = 300;

const ALL_SOURCES = ["thekallang", "eventbrite", "esplanade", "sportplus", "peatix", "fever", "tessera"];

async function handleScrape() {
  const { total, bySource, errors } = await runAllScrapers();

  await initializeDb();
  for (const source of ALL_SOURCES) {
    if (source in errors) {
      await insertScraperRun({ source, events_found: 0, error: errors[source] });
    } else {
      await insertScraperRun({ source, events_found: bySource[source] ?? 0, error: null });
    }
  }

  const zeroSources = ALL_SOURCES.filter(
    (s) => !(s in errors) && (bySource[s] ?? 0) === 0
  );
  const hasIssues = zeroSources.length > 0 || Object.keys(errors).length > 0;

  let alert = null;
  if (hasIssues) {
    alert = await sendPipelineReportEmail({
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

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return handleScrape();
}

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return handleScrape();
}
