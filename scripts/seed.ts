// TODO: Seed database with test events for development
// Run with: npx tsx scripts/seed.ts

import { initializeDb } from "../lib/db";

function main() {
  console.log("Initializing database...");
  initializeDb();
  console.log("Database initialized.");

  // TODO: Insert sample events with blurbs and tags
  console.log("Seeding not yet implemented.");
}

main();
