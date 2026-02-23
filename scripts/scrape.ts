// Run all scrapers manually
// Run with: npx tsx scripts/scrape.ts

import { initializeDb } from "../lib/db";
import { runAllScrapers } from "../lib/scrapers";

async function main() {
  console.log("Initializing database...");
  await initializeDb();

  console.log("Running scrapers...\n");
  const { total, bySource, errors } = await runAllScrapers();

  console.log("\n--- Results ---");
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}: ${count} new events`);
  }
  for (const [source, error] of Object.entries(errors)) {
    console.log(`  ${source}: FAILED — ${error}`);
  }
  console.log(`\nTotal: ${total} new events`);
}

main();
