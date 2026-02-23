// Seed database with 10 realistic Singapore events for development
// Run with: npx tsx scripts/seed.ts
// SAFETY: Refuses to run against Turso production databases

import { v4 } from "uuid";
import { initializeDb, getClient, insertEvent } from "../lib/db";

const dbUrl = process.env.TURSO_DATABASE_URL ?? "";
if (dbUrl.startsWith("libsql://") && !dbUrl.includes("localhost")) {
  console.error("ERROR: seed.ts cannot run against a remote Turso database.");
  console.error(`  TURSO_DATABASE_URL = ${dbUrl}`);
  console.error("Use a local database URL (e.g. file:db/events.db or libsql://localhost) for seeding.");
  process.exit(1);
}

function sgDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

const events: {
  raw_title: string;
  venue: string;
  blurb: string;
  tags: string[];
  day: number;
  isHeadsUp?: boolean;
}[] = [
  {
    raw_title: "Singapore Smash 2026",
    venue: "OCBC Arena, Sports Hub",
    blurb: "World-class table tennis returns to SG with $1.55M in prize money.",
    tags: ["game on", "bring someone"],
    day: 0,
  },
  {
    raw_title: "Impressionists: Monet to Matisse",
    venue: "National Gallery Singapore",
    blurb: "Rare loans from Musée d'Orsay — Monet, Renoir, and Matisse under one roof.",
    tags: ["go see", "bring someone", "once only"],
    day: 1,
  },
  {
    raw_title: "Aisyah Aziz Live",
    venue: "Esplanade Concert Hall",
    blurb: "Singapore's R&B queen brings her full band to the Esplanade stage.",
    tags: ["live & loud", "culture fix"],
    day: 2,
  },
  {
    raw_title: "Singapore Wine Fiesta",
    venue: "Quayside Isle, Sentosa",
    blurb: "Over 50 wines from boutique vineyards, paired with local bites.",
    tags: ["taste test", "bring someone"],
    day: 3,
  },
  {
    raw_title: "Shorts Film Festival",
    venue: "The Projector, Golden Mile",
    blurb: "Southeast Asian short films compete at SG's coolest indie cinema.",
    tags: ["screen time", "try lah"],
    day: 4,
  },
  {
    raw_title: "Gardens by the Bay Night Run",
    venue: "Gardens by the Bay",
    blurb: "5K and 10K routes through the Supertree Grove after dark.",
    tags: ["touch grass", "free lah"],
    day: 5,
  },
  {
    raw_title: "SSO Performs Rachmaninoff",
    venue: "Victoria Concert Hall",
    blurb: "The SSO tackles Rachmaninoff's Piano Concerto No. 2 — goosebumps guaranteed.",
    tags: ["culture fix", "once only"],
    day: 6,
  },
  {
    raw_title: "Geylang Serai Weekend Market",
    venue: "Geylang Serai Market",
    blurb: "Night market vibes with Malay street food, crafts, and live music.",
    tags: ["taste test", "free lah", "touch grass"],
    day: 8,
  },
  {
    raw_title: "Skate Festival SG",
    venue: "East Coast Park Area G",
    blurb: "Skating demos, beginner lessons, and a mini half-pipe by the beach.",
    tags: ["touch grass", "try lah", "free lah"],
    day: 10,
  },
  {
    raw_title: "Teza Comedy Night",
    venue: "The Lido, Shaw Theatres",
    blurb: "Stand-up showcase with five of SG's sharpest comedians.",
    tags: ["live & loud", "bring someone", "last call"],
    day: 12,
  },
  {
    raw_title: "Ottolenghi Live: The Fermentation Session",
    venue: "National Library, Auditorium",
    blurb: "The chef behind Plenty talks fermentation to a 200-seat room.",
    tags: ["taste test", "once only"],
    day: 22,
    isHeadsUp: true,
  },
  {
    raw_title: "Berlin Philharmonic Guest Residency",
    venue: "Esplanade Concert Hall",
    blurb: "Three nights of Beethoven from one of the world's finest orchestras.",
    tags: ["culture fix", "once only"],
    day: 35,
    isHeadsUp: true,
  },
];

async function main() {
  console.log("Initializing database...");
  await initializeDb();

  const db = getClient();
  await db.execute("DELETE FROM events");
  console.log("Cleared existing events.");

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    await insertEvent({
      id: v4(),
      source: "manual",
      source_url: `https://example.com/seed/${i + 1}`,
      raw_title: e.raw_title,
      raw_description: null,
      venue: e.venue,
      event_date_start: sgDate(e.day),
      event_date_end: null,
      llm_included: 1,
      llm_filter_reason: "Seed data",
      blurb: e.blurb,
      tags: JSON.stringify(e.tags),
      is_manually_added: 1,
      is_published: 1,
      is_heads_up: e.isHeadsUp ? 1 : 0,
    });
    console.log(`  [${i + 1}] ${e.raw_title} — ${sgDate(e.day)}`);
  }

  console.log(`\nSeeded ${events.length} events.`);
}

main();
