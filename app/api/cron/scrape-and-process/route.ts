import { NextRequest, NextResponse } from "next/server";
import { runAllScrapers } from "../../../../lib/scrapers";
import { getLatestScraperStats, getPublishedEvents, replaceWindowPicks } from "../../../../lib/db";
import { sendPipelineReportEmail, LlmPipelineStats } from "../../../../lib/email";
import { processUnfilteredEvents, runEditorPass } from "../../../../lib/llm";
import { verifyCronAuth } from "../../../../lib/cron-auth";
import { getMonday, getSunday } from "../../../../lib/dates";

// Nightly editorial ranking of the current week's published events.
// Runs regardless of backlog state — unprocessed events are unpublished and
// invisible, so ranking the published set is always valid. Isolated: failure
// logs and falls back to deterministic selection, never fails the cron.
async function runNightlyEditorPass(): Promise<string> {
  const todaySgt = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const windowStart = getMonday(todaySgt);
  // Rank what the public actually sees: the remainder of the calendar week.
  const eligible = await getPublishedEvents(todaySgt, getSunday(todaySgt));
  if (eligible.length < 2) return `skipped (${eligible.length} eligible)`;

  const picks = await runEditorPass(eligible, todaySgt);
  if (!picks) return "failed validation — deterministic fallback stays";

  await replaceWindowPicks(
    windowStart,
    picks.map((p) => ({ eventId: p.eventId, rank: p.rank, reason: p.reason }))
  );
  return `ranked ${picks.length}/${eligible.length} for week of ${windowStart}`;
}

export const maxDuration = 60;

const ALL_SOURCES = ["thekallang", "eventbrite", "esplanade", "sportplus", "peatix", "fever", "tessera", "scape", "srt", "bookmyshow", "filmhouse"];

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
    let remaining = Infinity;

    try {
      while (remaining > 0) {
        if (Date.now() - startTime > TIME_LIMIT_MS) {
          console.log(`[process] Time guard hit after ${llmBatches} batches (${totalProcessed} events). Stopping LLM loop.`);
          break;
        }
        const result = await processUnfilteredEvents(20, { dedup: llmBatches === 0 });
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

    // Editorial pass — only if the drain left enough of the time budget
    // (~10s for the LLM call + write, without eating the report email's 15s).
    let editorOutcome = "skipped (time budget exhausted)";
    if (Date.now() - startTime < 35_000) {
      try {
        editorOutcome = await runNightlyEditorPass();
      } catch (error) {
        console.error("[process] Editor pass error:", error);
        editorOutcome = `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    console.log(`[process] Editor pass: ${editorOutcome}`);

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
      editor: editorOutcome,
      scraperStats: scraperStats ? "from_db" : "unavailable",
      alert,
    });
  }

  // Action: scrape-only
  if (action === "scrape") {
    // runAllScrapers records each scraper_runs row as that scraper settles.
    const { total, bySource, errors } = await runAllScrapers();
    const hasErrors = Object.keys(errors).length > 0;
    return NextResponse.json({
      success: !hasErrors,
      total,
      bySource,
      errors,
    });
  }

  // Default: full pipeline (scrape + process + report) — manual-only fallback, not used by cron.
  // NB: this branch does NOT refresh window_picks; the nightly ?action=process run does.

  // Phase 1: Scrape (parallel — fits within timeout, logs its own scraper_runs)
  const { total, bySource, errors } = await runAllScrapers();

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
      const result = await processUnfilteredEvents(20, { dedup: llmBatches === 0 });
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
