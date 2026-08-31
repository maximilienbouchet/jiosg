// Re-run the CURRENT filter prompt over upcoming published events.
//
// The filter prompt evolves (e.g. the repertory-cinema policy); events
// published under an older prompt stay visible forever unless rechecked.
// This sweep re-filters them and unpublishes what today's prompt rejects —
// preserving blurb/tags/score so an admin can restore anything with one
// toggle. The filter reason is prefixed with [resweep] for the audit trail.
//
// Run with:  npx tsx --env-file=.env.local scripts/refilter-published.ts [--apply]
//   (default is a dry run)

import { initializeDb, getClient, type EventRow } from "../lib/db";
import { filterEvent } from "../lib/llm";

const apply = process.argv.includes("--apply");
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDates(e: EventRow): string {
  const start = e.event_date_start.slice(0, 10);
  const end = e.event_date_end?.slice(0, 10);
  return end && end !== start ? `${start} – ${end}` : start;
}

async function main() {
  await initializeDb();
  const db = getClient();

  const result = await db.execute(
    `SELECT * FROM events
     WHERE is_published = 1 AND is_duplicate = 0
       AND date(event_date_start) >= date('now')
     ORDER BY event_date_start ASC`
  );
  const events = result.rows as unknown as EventRow[];

  console.log(`\n=== Re-filter sweep ${apply ? "(APPLYING)" : "(dry run)"} ===`);
  console.log(`${events.length} upcoming published events\n`);

  let kept = 0;
  const rejected: { event: EventRow; reason: string }[] = [];

  for (let i = 0; i < events.length; i += CONCURRENCY) {
    const batch = events.slice(i, i + CONCURRENCY);
    const verdicts = await Promise.all(
      batch.map(async (event) => {
        const description = event.enriched_description ?? event.raw_description;
        const verdict = await filterEvent(
          event.raw_title,
          description,
          event.venue,
          formatDates(event),
          event.source
        );
        return { event, verdict };
      })
    );

    for (const { event, verdict } of verdicts) {
      if (verdict.include) {
        kept++;
        continue;
      }
      rejected.push({ event, reason: verdict.reason });
      console.log(`REJECT [${event.source}] "${event.raw_title}" (${event.event_date_start.slice(0, 10)})`);
      console.log(`       ${verdict.reason.slice(0, 140)}`);

      if (apply) {
        await db.execute({
          sql: `UPDATE events
                SET llm_included = 0, is_published = 0,
                    llm_filter_reason = ?, updated_at = datetime('now')
                WHERE id = ?`,
          args: [`[resweep] ${verdict.reason}`.slice(0, 500), event.id],
        });
      }
    }

    if (i + CONCURRENCY < events.length) await delay(BATCH_DELAY_MS);
    if ((i / CONCURRENCY) % 5 === 4) {
      console.log(`  ...${Math.min(i + CONCURRENCY, events.length)}/${events.length} checked`);
    }
  }

  console.log(`\n--- kept ${kept}, rejected ${rejected.length} of ${events.length} ---`);
  if (!apply && rejected.length > 0) console.log("Re-run with --apply to unpublish the rejects.");
  if (apply && rejected.length > 0) {
    console.log("Rejects unpublished (blurb/tags/score preserved; reasons prefixed [resweep]).");
  }
}

main();
