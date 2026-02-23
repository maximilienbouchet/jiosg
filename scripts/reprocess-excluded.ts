// Reset excluded events for re-evaluation with relaxed filter,
// and re-publish events that scored >= 6 but were below the old threshold of 7.
// Run with: npx tsx scripts/reprocess-excluded.ts

import { getClient, initializeDb } from "../lib/db";

async function main() {
  await initializeDb();
  const db = getClient();

  // 1. Reset excluded future events so they get re-evaluated by the relaxed filter
  const resetResult = await db.execute({
    sql: `UPDATE events
          SET llm_included = NULL, llm_filter_reason = NULL, updated_at = datetime('now')
          WHERE llm_included = 0
            AND event_date_start >= date('now')
            AND is_duplicate = 0`,
    args: [],
  });
  console.log(`[reset] Set llm_included = NULL for ${resetResult.rowsAffected} excluded future events`);

  // 2. Re-publish events that passed the filter with score >= 6 but weren't published (old threshold was 7)
  const republishResult = await db.execute({
    sql: `UPDATE events
          SET is_published = 1, updated_at = datetime('now')
          WHERE llm_included = 1
            AND llm_score >= 6
            AND is_published = 0
            AND event_date_start >= date('now')
            AND is_duplicate = 0`,
    args: [],
  });
  console.log(`[republish] Published ${republishResult.rowsAffected} events with score >= 6`);

  // 3. Show summary of what's now pending re-evaluation
  const pending = await db.execute({
    sql: `SELECT COUNT(*) as count FROM events WHERE llm_included IS NULL AND is_duplicate = 0`,
    args: [],
  });
  const pendingCount = (pending.rows[0] as unknown as { count: number }).count;
  console.log(`\n${pendingCount} events now pending LLM processing.`);
  console.log("Trigger processing via: curl -X POST your-site/api/cron/process -H 'x-cron-secret: ...'");
}

main();
