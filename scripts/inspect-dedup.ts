import { initializeDb, getClient, type EventRow } from "../lib/db";

async function main() {
  await initializeDb();
  const db = getClient();

  const duplicatesResult = await db.execute(
    "SELECT * FROM events WHERE is_duplicate = 1 ORDER BY event_date_start ASC"
  );
  const duplicates = duplicatesResult.rows as unknown as EventRow[];

  const totalResult = await db.execute("SELECT COUNT(*) as count FROM events");
  const totalEvents = Number(totalResult.rows[0].count);
  const dupCount = duplicates.length;

  console.log(`\n=== Dedup Inspection ===`);
  console.log(`Total events: ${totalEvents}`);
  console.log(`Duplicates:   ${dupCount}`);
  console.log(`Unique:       ${totalEvents - dupCount}\n`);

  if (duplicates.length === 0) {
    console.log("No duplicates found.\n");
    process.exit(0);
  }

  for (const dup of duplicates) {
    let canonical: EventRow | undefined;
    if (dup.duplicate_of) {
      const canonicalResult = await db.execute({
        sql: "SELECT * FROM events WHERE id = ?",
        args: [dup.duplicate_of],
      });
      canonical = canonicalResult.rows[0] as unknown as EventRow | undefined;
    }

    console.log(`DUPLICATE: "${dup.raw_title}"`);
    console.log(`  Source: ${dup.source} | Venue: ${dup.venue} | Date: ${dup.event_date_start.slice(0, 10)}`);
    console.log(`  URL: ${dup.source_url}`);
    if (canonical) {
      console.log(`  -> Canonical: "${canonical.raw_title}"`);
      console.log(`     Source: ${canonical.source} | Venue: ${canonical.venue} | Date: ${canonical.event_date_start.slice(0, 10)}`);
      console.log(`     URL: ${canonical.source_url}`);
    } else {
      console.log(`  -> Canonical: (not found — id: ${dup.duplicate_of})`);
    }
    console.log();
  }
}

main();
