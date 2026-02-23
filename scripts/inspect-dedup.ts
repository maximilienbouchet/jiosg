import { initializeDb, getDb, type EventRow } from "../lib/db";

initializeDb();
const db = getDb();

const duplicates = db
  .prepare("SELECT * FROM events WHERE is_duplicate = 1 ORDER BY event_date_start ASC")
  .all() as EventRow[];

const totalEvents = (db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number }).count;
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
  const canonical = dup.duplicate_of
    ? (db.prepare("SELECT * FROM events WHERE id = ?").get(dup.duplicate_of) as EventRow | undefined)
    : null;

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
