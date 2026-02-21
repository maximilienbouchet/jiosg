import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "db", "events.db");

let db: Database.Database | null = null;

export interface EventRow {
  id: string;
  source: string;
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
  scraped_at: string;
  llm_included: number | null;
  llm_filter_reason: string | null;
  blurb: string | null;
  tags: string | null;
  is_manually_added: number;
  is_published: number;
  thumbs_up: number;
  thumbs_down: number;
  created_at: string;
  updated_at: string;
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initializeDb(): void {
  const database = getDb();
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  database.exec(schema);
}

export function getPublishedEvents(startDate: string, endDate: string): EventRow[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM events
    WHERE is_published = 1
      AND date(event_date_start) >= ?
      AND date(event_date_start) <= ?
    ORDER BY event_date_start ASC
  `);
  return stmt.all(startDate, endDate) as EventRow[];
}

export function incrementThumbs(eventId: string, direction: "up" | "down"): boolean {
  const database = getDb();
  const column = direction === "up" ? "thumbs_up" : "thumbs_down";
  const stmt = database.prepare(`
    UPDATE events SET ${column} = ${column} + 1, updated_at = datetime('now') WHERE id = ?
  `);
  const result = stmt.run(eventId);
  return result.changes > 0;
}

export function insertEvent(event: {
  id: string;
  source: string;
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
  llm_included: number | null;
  llm_filter_reason: string | null;
  blurb: string | null;
  tags: string | null;
  is_manually_added: number;
  is_published: number;
}): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO events (
      id, source, source_url, raw_title, raw_description, venue,
      event_date_start, event_date_end, scraped_at,
      llm_included, llm_filter_reason, blurb, tags,
      is_manually_added, is_published,
      thumbs_up, thumbs_down, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, datetime('now'),
      ?, ?, ?, ?,
      ?, ?,
      0, 0, datetime('now'), datetime('now')
    )
  `);
  stmt.run(
    event.id, event.source, event.source_url, event.raw_title, event.raw_description, event.venue,
    event.event_date_start, event.event_date_end,
    event.llm_included, event.llm_filter_reason, event.blurb, event.tags,
    event.is_manually_added, event.is_published
  );
}
