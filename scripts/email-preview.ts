import { buildDigestHtml } from "../lib/email";
import type { EventRow } from "../lib/db";
import fs from "fs";
import path from "path";

const mockEvents: EventRow[] = [
  {
    id: "1", source: "thekallang", source_url: "https://example.com/smash",
    raw_title: "Singapore Smash 2026", raw_description: null,
    venue: "The Kallang \u00b7 Infinity Arena",
    event_date_start: "2026-02-23", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "World-class table tennis returns with $1.55M in prize money.",
    tags: JSON.stringify(["game on", "bring someone"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 85,
    thumbs_up: 3, thumbs_down: 0, created_at: "2026-02-20", updated_at: "2026-02-20",
  },
  {
    id: "2", source: "esplanade", source_url: "https://example.com/jazz",
    raw_title: "Late Night Jazz: Akira Tana Trio",
    raw_description: null, venue: "Esplanade \u00b7 Recital Studio",
    event_date_start: "2026-02-23", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "San Francisco-based drummer Akira Tana brings bop and swing to Esplanade.",
    tags: JSON.stringify(["live & loud", "culture fix"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 90,
    thumbs_up: 5, thumbs_down: 1, created_at: "2026-02-20", updated_at: "2026-02-20",
  },
  {
    id: "3", source: "eventbrite", source_url: "https://example.com/wine",
    raw_title: "Natural Wine Fair", raw_description: null,
    venue: "Tiong Bahru Market",
    event_date_start: "2026-02-25", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "Twelve natural wine importers pour their best in a hawker centre setting.",
    tags: JSON.stringify(["taste test", "try lah"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 88,
    thumbs_up: 8, thumbs_down: 0, created_at: "2026-02-20", updated_at: "2026-02-20",
  },
];

const mockHeadsUp: EventRow[] = [
  {
    id: "4", source: "manual", source_url: "https://example.com/ottolenghi",
    raw_title: "Ottolenghi Live", raw_description: null,
    venue: "National Library \u00b7 Auditorium",
    event_date_start: "2026-03-15", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "The chef talks fermentation \u2014 tickets selling fast.",
    tags: JSON.stringify(["taste test", "once only"]),
    is_manually_added: 1, is_published: 1, is_heads_up: 1, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 95,
    thumbs_up: 12, thumbs_down: 0, created_at: "2026-02-20", updated_at: "2026-02-20",
  },
];

const html = buildDigestHtml(mockEvents, mockHeadsUp, "https://jio.sg", "test-token-123", {
  startDate: "2026-02-23",
  endDate: "2026-02-26",
  introHtml: "Big weekend ahead — Singapore Smash brings world-class table tennis to the Kallang, and a natural wine fair is taking over Tiong Bahru. Don't sleep on the late-night jazz at Esplanade either.",
});
const outDir = path.join(process.cwd(), "test-screenshots");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "email-preview.html");
fs.writeFileSync(outPath, html);
console.log(`Email preview written to ${outPath}`);
