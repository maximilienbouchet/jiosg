import { buildDigestHtml } from "../lib/email";
import type { EventRow } from "../lib/db";
import fs from "fs";
import path from "path";

const mockNewEvents: EventRow[] = [
  {
    id: "1", source: "thekallang", source_url: "https://example.com/smash",
    raw_title: "Singapore Smash 2026", raw_description: null,
    venue: "The Kallang · Infinity Arena",
    event_date_start: "2026-02-23", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "World-class table tennis returns with $1.55M in prize money.",
    tags: JSON.stringify(["game on", "bring someone"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 8,
    created_at: "2026-02-20", updated_at: "2026-02-20",
  },
  {
    id: "2", source: "esplanade", source_url: "https://example.com/jazz",
    raw_title: "Late Night Jazz: Akira Tana Trio",
    raw_description: null, venue: "Esplanade · Recital Studio",
    event_date_start: "2026-02-23", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "San Francisco-based drummer Akira Tana brings bop and swing to Esplanade.",
    tags: JSON.stringify(["live & loud", "culture fix"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 9,
    created_at: "2026-02-20", updated_at: "2026-02-20",
  },
  {
    id: "3", source: "eventbrite", source_url: "https://example.com/wine",
    raw_title: "Natural Wine Fair", raw_description: null,
    venue: "Tiong Bahru Market",
    event_date_start: "2026-02-25", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "Twelve natural wine importers pour their best in a hawker centre setting.",
    tags: JSON.stringify(["taste test", "try lah"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 8,
    created_at: "2026-02-20", updated_at: "2026-02-20",
  },
];

// Mock ongoing: multi-day exhibition that was in last digest
const mockOngoingEvents: EventRow[] = [
  {
    id: "10", source: "manual", source_url: "https://example.com/monet",
    raw_title: "Monet to Matisse: Impressionists",
    raw_description: null, venue: "National Gallery Singapore",
    event_date_start: "2026-01-10", event_date_end: "2026-04-15",
    scraped_at: "2026-01-08", llm_included: 1, llm_filter_reason: null,
    blurb: "Rare loans from Musée d'Orsay in a landmark Singapore showing.",
    tags: JSON.stringify(["go see", "bring someone"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 8,
    created_at: "2026-01-08", updated_at: "2026-01-08",
  },
  {
    id: "11", source: "manual", source_url: "https://example.com/cirque",
    raw_title: "Cirque du Soleil: KOOZA",
    raw_description: null, venue: "Marina Bay Sands · Big Top",
    event_date_start: "2026-02-01", event_date_end: "2026-03-31",
    scraped_at: "2026-01-20", llm_included: 1, llm_filter_reason: null,
    blurb: "Cirque's most acrobatic show under the big top at MBS.",
    tags: JSON.stringify(["culture fix", "bring someone"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 8,
    created_at: "2026-01-20", updated_at: "2026-01-20",
  },
];

// Mock ending soon: multi-day event closing within the window
const mockEndingSoonEvents: EventRow[] = [
  {
    id: "20", source: "esplanade", source_url: "https://example.com/photo",
    raw_title: "Singapore Through the Lens",
    raw_description: null, venue: "Esplanade · Concourse",
    event_date_start: "2026-02-01", event_date_end: "2026-02-26",
    scraped_at: "2026-01-28", llm_included: 1, llm_filter_reason: null,
    blurb: "A photographic journey through 60 years of Singapore's transformation.",
    tags: JSON.stringify(["go see", "free lah"]),
    is_manually_added: 0, is_published: 1, is_heads_up: 0, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 7,
    created_at: "2026-01-28", updated_at: "2026-01-28",
  },
];

const mockHeadsUp: EventRow[] = [
  {
    id: "4", source: "manual", source_url: "https://example.com/ottolenghi",
    raw_title: "Ottolenghi Live", raw_description: null,
    venue: "National Library · Auditorium",
    event_date_start: "2026-03-15", event_date_end: null,
    scraped_at: "2026-02-20", llm_included: 1, llm_filter_reason: null,
    blurb: "The chef talks fermentation — tickets selling fast.",
    tags: JSON.stringify(["taste test", "once only"]),
    is_manually_added: 1, is_published: 1, is_heads_up: 1, is_duplicate: 0, duplicate_of: null, enriched_description: null, llm_score: 9,
    created_at: "2026-02-20", updated_at: "2026-02-20",
  },
];

// Pre-classified events (simulating what classifyDigestEvents would return)
const classified = {
  newEvents: mockNewEvents,
  ongoingEvents: mockOngoingEvents,
  endingSoonEvents: mockEndingSoonEvents,
};

const html = buildDigestHtml(classified, mockHeadsUp, "https://jio.sg", "test-token-123", {
  startDate: "2026-02-23",
  endDate: "2026-02-26",
  introHtml: "Big weekend ahead — Singapore Smash brings world-class table tennis to the Kallang, and a natural wine fair is taking over Tiong Bahru. Last chance to catch <em>Singapore Through the Lens</em> at Esplanade before it closes Wednesday.",
});
const outDir = path.join(process.cwd(), "test-screenshots");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "email-preview.html");
fs.writeFileSync(outPath, html);
console.log(`Email preview written to ${outPath}`);
