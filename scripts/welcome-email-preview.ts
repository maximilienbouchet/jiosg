import { buildWelcomeHtml } from "../lib/email";
import type { EventRow } from "../lib/db";
import fs from "fs";
import path from "path";

const mockEvents: EventRow[] = [
  {
    id: "1", source: "thekallang", source_url: "https://example.com/smash",
    raw_title: "Singapore Smash 2026", raw_description: null,
    venue: "The Kallang · Infinity Arena",
    event_date_start: "2026-03-15", event_date_end: null,
    scraped_at: "2026-03-01", llm_included: 1, llm_filter_reason: null,
    blurb: "World-class table tennis returns with $1.55M in prize money.",
    tags: JSON.stringify(["game on", "bring someone"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 1, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 85,
    created_at: "2026-03-01", updated_at: "2026-03-01",
  },
  {
    id: "2", source: "esplanade", source_url: "https://example.com/jazz",
    raw_title: "Late Night Jazz: Akira Tana Trio",
    raw_description: null, venue: "Esplanade · Recital Studio",
    event_date_start: "2026-03-15", event_date_end: null,
    scraped_at: "2026-03-01", llm_included: 1, llm_filter_reason: null,
    blurb: "San Francisco-based drummer Akira Tana brings bop and swing to Esplanade.",
    tags: JSON.stringify(["live & loud", "culture fix"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 1, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 90,
    created_at: "2026-03-01", updated_at: "2026-03-01",
  },
];

const html = buildWelcomeHtml(mockEvents, "https://jio.sg", "test-token-123");
const outDir = path.join(process.cwd(), "test-screenshots");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "welcome-email-preview.html");
fs.writeFileSync(outPath, html);
console.log(`Welcome email preview written to ${outPath}`);
