// Re-generate blurbs for all published events using the updated prompt
// Run with: npx tsx scripts/reprocess-blurbs.ts

import { getClient, initializeDb, type EventRow } from "../lib/db";
import { generateBlurbAndTags } from "../lib/llm";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await initializeDb();
  const db = getClient();

  const result = await db.execute(
    "SELECT * FROM events WHERE is_published = 1 AND llm_included = 1"
  );
  const events = result.rows as unknown as EventRow[];

  console.log(`Found ${events.length} published events to reprocess.\n`);

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (event) => {
        const blurbResult = await generateBlurbAndTags(
          event.raw_title,
          event.raw_description,
          event.venue
        );
        await db.execute({
          sql: "UPDATE events SET blurb = ?, updated_at = datetime('now') WHERE id = ?",
          args: [blurbResult.blurb, event.id],
        });
        return { title: event.raw_title, oldBlurb: event.blurb, newBlurb: blurbResult.blurb };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        updated++;
        console.log(`[${updated}] ${r.value.title}`);
        console.log(`  OLD: ${r.value.oldBlurb}`);
        console.log(`  NEW: ${r.value.newBlurb}\n`);
      } else {
        errors++;
        console.error(`  ERROR: ${r.reason}`);
      }
    }

    if (i + BATCH_SIZE < events.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);
}

main();
