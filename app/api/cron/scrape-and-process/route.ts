import { NextRequest, NextResponse } from "next/server";
import { runAllScrapers } from "../../../../lib/scrapers";
import { initializeDb, insertScraperRun } from "../../../../lib/db";
import { sendPipelineReportEmail, LlmPipelineStats } from "../../../../lib/email";
import { processUnfilteredEvents } from "../../../../lib/llm";
import { verifyCronAuth } from "../../../../lib/cron-auth";

export const maxDuration = 300;

const ALL_SOURCES = ["thekallang", "eventbrite", "esplanade", "sportplus", "peatix", "fever", "tessera"];

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  // Phase 1: Scrape
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

  // Phase 2: LLM processing — loop until backlog is cleared
  let totalProcessed = 0;
  let totalIncluded = 0;
  let totalExcluded = 0;
  let totalLlmErrors = 0;
  let totalDeduplicated = 0;
  let llmBatches = 0;
  let llmCrashed = false;
  let llmCrashError: string | undefined;

  try {
    let remaining = Infinity;
    while (remaining > 0) {
      const result = await processUnfilteredEvents(20);
      totalProcessed += result.processed;
      totalIncluded += result.included;
      totalExcluded += result.excluded;
      totalLlmErrors += result.errors;
      totalDeduplicated += result.deduplicated;
      remaining = result.remaining;
      llmBatches++;

      if (result.processed === 0) break;
    }
  } catch (error) {
    console.error("[scrape-and-process] LLM processing error:", error);
    llmCrashed = true;
    llmCrashError = error instanceof Error ? error.message : String(error);
  }

  // Phase 3: Send pipeline report email (always, after LLM)
  const llmStats: LlmPipelineStats = {
    processed: totalProcessed,
    included: totalIncluded,
    excluded: totalExcluded,
    errors: totalLlmErrors,
    deduplicated: totalDeduplicated,
    batches: llmBatches,
    crashed: llmCrashed || undefined,
    crashError: llmCrashError,
  };

  const alert = await sendPipelineReportEmail(
    { zeroSources, errorSources: errors, bySource },
    llmStats
  );

  const hasErrors = Object.keys(errors).length > 0;

  return NextResponse.json({
    success: !hasErrors && !llmCrashed,
    scrape: {
      total,
      bySource,
      errors,
    },
    llm: llmStats,
    alert,
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
