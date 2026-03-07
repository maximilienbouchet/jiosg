import { NextRequest, NextResponse } from "next/server";
import { runAllScrapers } from "../../../../lib/scrapers";
import { initializeDb, insertScraperRun, getLatestScraperStats } from "../../../../lib/db";
import { sendPipelineReportEmail, LlmPipelineStats } from "../../../../lib/email";
import { processUnfilteredEvents } from "../../../../lib/llm";
import { verifyCronAuth } from "../../../../lib/cron-auth";

export const maxDuration = 60;

const ALL_SOURCES = ["thekallang", "eventbrite", "esplanade", "sportplus", "peatix", "fever", "tessera", "scape", "srt"];

// GET /api/cron/scrape-and-process              → full pipeline (default)
// GET /api/cron/scrape-and-process?action=scrape  → scrape only
// GET /api/cron/scrape-and-process?action=process → LLM only
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const action = request.nextUrl.searchParams.get("action");

  // Action: process-only (LLM + report email)
  if (action === "process") {
    const startTime = Date.now();
    const TIME_LIMIT_MS = 45_000; // 45s — leave 15s headroom for report email

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
        if (Date.now() - startTime > TIME_LIMIT_MS) {
          console.log(`[process] Time guard hit after ${llmBatches} batches (${totalProcessed} events). Stopping LLM loop.`);
          break;
        }
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
      console.error("[process] LLM processing error:", error);
      llmCrashed = true;
      llmCrashError = error instanceof Error ? error.message : String(error);
    }

    // Reconstruct scraper stats from the most recent scraper run in DB
    const scraperStats = await getLatestScraperStats();

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

    let alert;
    try {
      alert = await sendPipelineReportEmail(
        scraperStats ?? { zeroSources: [], errorSources: {}, bySource: {} },
        llmStats
      );
    } catch (emailError) {
      console.error("[process] Failed to send report email:", emailError);
      alert = { error: emailError instanceof Error ? emailError.message : String(emailError) };
    }

    return NextResponse.json({
      success: !llmCrashed,
      llm: llmStats,
      scraperStats: scraperStats ? "from_db" : "unavailable",
      alert,
    });
  }

  // Action: scrape-only
  if (action === "scrape") {
    const { total, bySource, errors } = await runAllScrapers();
    await initializeDb();
    for (const source of ALL_SOURCES) {
      if (source in errors) {
        await insertScraperRun({ source, events_found: 0, error: errors[source] });
      } else {
        await insertScraperRun({ source, events_found: bySource[source] ?? 0, error: null });
      }
    }
    const hasErrors = Object.keys(errors).length > 0;
    return NextResponse.json({
      success: !hasErrors,
      total,
      bySource,
      errors,
    });
  }

  // Default: full pipeline (scrape + process + report) — manual-only fallback, not used by cron

  // Phase 1: Scrape (parallel — fits within timeout)
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

  // Phase 2: LLM processing — single batch to stay within timeout
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

  // Phase 3: Send pipeline report email (after LLM so stats are included)
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
