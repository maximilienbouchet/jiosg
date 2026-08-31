// Retroactively deduplicate events that have ALREADY been through the LLM.
//
// The live pipeline (lib/dedup.ts) only ever compares *unprocessed* events, so a
// duplicate pair that both got processed and published can never be caught. This
// script sweeps the whole forward-looking set and marks the losers.
//
// Run with:  npx tsx --env-file=.env.local scripts/dedup-backfill.ts [--apply] [--all]
//   (default is a dry run; --all includes past events too)

import { initializeDb, getClient, markAsDuplicate, type EventRow } from "../lib/db";
import { eventsAreDuplicates } from "../lib/dedup";

const apply = process.argv.includes("--apply");
const includePast = process.argv.includes("--all");

/** Prefer the copy that is already visible, then the better-described one. */
function chooseCanonical(a: EventRow, b: EventRow): { canonical: EventRow; duplicate: EventRow } {
  const rank = (e: EventRow) =>
    (e.is_published ? 4 : 0) +
    (e.llm_included !== null ? 2 : 0) +
    (e.is_manually_added ? 1 : 0);

  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) {
    return rankA > rankB ? { canonical: a, duplicate: b } : { canonical: b, duplicate: a };
  }

  const descA = (a.enriched_description ?? a.raw_description ?? "").length;
  const descB = (b.enriched_description ?? b.raw_description ?? "").length;
  if (descA !== descB) {
    return descA > descB ? { canonical: a, duplicate: b } : { canonical: b, duplicate: a };
  }

  return a.created_at <= b.created_at ? { canonical: a, duplicate: b } : { canonical: b, duplicate: a };
}

async function main() {
  await initializeDb();
  const db = getClient();

  const result = await db.execute(
    includePast
      ? `SELECT * FROM events WHERE is_duplicate = 0 ORDER BY event_date_start ASC`
      : `SELECT * FROM events WHERE is_duplicate = 0 AND date(event_date_start) >= date('now')
         ORDER BY event_date_start ASC`
  );
  const events = result.rows as unknown as EventRow[];

  console.log(`\n=== Dedup backfill ${apply ? "(APPLYING)" : "(dry run)"} ===`);
  console.log(`Scanning ${events.length} non-duplicate events${includePast ? " (all time)" : " (today onward)"}\n`);

  const marked = new Set<string>();
  let pairs = 0;
  let publishedPairs = 0;

  for (let i = 0; i < events.length; i++) {
    if (marked.has(events[i].id)) continue;
    for (let j = i + 1; j < events.length; j++) {
      if (marked.has(events[j].id)) continue;
      if (!eventsAreDuplicates(events[i], events[j])) continue;

      const { canonical, duplicate } = chooseCanonical(events[i], events[j]);
      marked.add(duplicate.id);
      pairs++;
      const bothVisible = canonical.is_published === 1 && duplicate.is_published === 1;
      if (bothVisible) publishedPairs++;

      console.log(`${bothVisible ? "!! BOTH LIVE" : "  "}`);
      console.log(`      drop [${duplicate.source}] "${duplicate.raw_title}"`);
      console.log(`           ${duplicate.venue} — ${duplicate.event_date_start.slice(0, 10)}`);
      console.log(`      keep [${canonical.source}] "${canonical.raw_title}"`);
      console.log(`           ${canonical.venue} — ${canonical.event_date_start.slice(0, 10)}`);

      if (apply) await markAsDuplicate(duplicate.id, canonical.id);
    }
  }

  console.log(`\n--- ${pairs} duplicate(s) found, ${publishedPairs} of them currently visible on the site ---`);
  if (!apply && pairs > 0) console.log(`Re-run with --apply to mark them.`);
}

main();
