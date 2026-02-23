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
  is_heads_up: number;
  llm_score: number | null;
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

  // Migrations for existing databases
  const columns = database.pragma("table_info(events)") as { name: string }[];
  if (!columns.some((c) => c.name === "is_heads_up")) {
    database.exec("ALTER TABLE events ADD COLUMN is_heads_up INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((c) => c.name === "llm_score")) {
    database.exec("ALTER TABLE events ADD COLUMN llm_score INTEGER");
  }
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
  is_heads_up?: number;
}): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO events (
      id, source, source_url, raw_title, raw_description, venue,
      event_date_start, event_date_end, scraped_at,
      llm_included, llm_filter_reason, blurb, tags,
      is_manually_added, is_published, is_heads_up,
      thumbs_up, thumbs_down, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, datetime('now'),
      ?, ?, ?, ?,
      ?, ?, ?,
      0, 0, datetime('now'), datetime('now')
    )
  `);
  stmt.run(
    event.id, event.source, event.source_url, event.raw_title, event.raw_description, event.venue,
    event.event_date_start, event.event_date_end,
    event.llm_included, event.llm_filter_reason, event.blurb, event.tags,
    event.is_manually_added, event.is_published, event.is_heads_up ?? 0
  );
}

export function upsertEvent(event: {
  source: string;
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
}): { inserted: boolean } {
  const database = getDb();
  const existing = database
    .prepare("SELECT id FROM events WHERE source_url = ?")
    .get(event.source_url);

  const stmt = database.prepare(`
    INSERT INTO events (
      id, source, source_url, raw_title, raw_description, venue,
      event_date_start, event_date_end, scraped_at,
      is_manually_added, is_published,
      thumbs_up, thumbs_down, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, datetime('now'),
      0, 0,
      0, 0, datetime('now'), datetime('now')
    )
    ON CONFLICT(source_url) DO UPDATE SET
      raw_title = excluded.raw_title,
      raw_description = excluded.raw_description,
      venue = excluded.venue,
      event_date_start = excluded.event_date_start,
      event_date_end = excluded.event_date_end,
      updated_at = datetime('now')
  `);

  const id = crypto.randomUUID();
  stmt.run(
    id, event.source, event.source_url, event.raw_title, event.raw_description, event.venue,
    event.event_date_start, event.event_date_end
  );

  return { inserted: !existing };
}

export function getUnprocessedEvents(limit?: number): EventRow[] {
  const database = getDb();
  const sql = limit
    ? `SELECT * FROM events WHERE llm_included IS NULL ORDER BY event_date_start ASC LIMIT ?`
    : `SELECT * FROM events WHERE llm_included IS NULL ORDER BY event_date_start ASC`;
  const stmt = database.prepare(sql);
  return (limit ? stmt.all(limit) : stmt.all()) as EventRow[];
}

export function countUnprocessedEvents(): number {
  const database = getDb();
  const row = database
    .prepare("SELECT COUNT(*) as count FROM events WHERE llm_included IS NULL")
    .get() as { count: number };
  return row.count;
}

export function updateEventLlmResults(
  eventId: string,
  data: {
    llm_included: number;
    llm_filter_reason: string | null;
    blurb: string | null;
    tags: string[] | null;
    is_published: number;
    is_heads_up?: number;
    llm_score?: number | null;
  }
): void {
  const database = getDb();
  const stmt = database.prepare(`
    UPDATE events
    SET llm_included = ?,
        llm_filter_reason = ?,
        blurb = ?,
        tags = ?,
        is_published = ?,
        is_heads_up = ?,
        llm_score = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(
    data.llm_included,
    data.llm_filter_reason,
    data.blurb,
    data.tags ? JSON.stringify(data.tags) : null,
    data.is_published,
    data.is_heads_up ?? 0,
    data.llm_score ?? null,
    eventId
  );
}

export function getHeadsUpEvents(todaySgt: string): EventRow[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM events
    WHERE is_heads_up = 1
      AND is_published = 1
      AND date(event_date_start) > date(?, '+7 days')
    ORDER BY event_date_start ASC
    LIMIT 3
  `);
  return stmt.all(todaySgt) as EventRow[];
}

export function getAllEvents(): EventRow[] {
  const database = getDb();
  const stmt = database.prepare("SELECT * FROM events ORDER BY event_date_start DESC");
  return stmt.all() as EventRow[];
}

export function getEventById(eventId: string): EventRow | undefined {
  const database = getDb();
  const stmt = database.prepare("SELECT * FROM events WHERE id = ?");
  return stmt.get(eventId) as EventRow | undefined;
}

const ALLOWED_UPDATE_COLUMNS = new Set([
  "raw_title", "venue", "blurb", "tags",
  "is_published", "is_heads_up", "llm_score",
  "event_date_start", "event_date_end",
]);

export function updateEvent(
  eventId: string,
  data: Record<string, unknown>
): boolean {
  const database = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_UPDATE_COLUMNS.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(key === "tags" && Array.isArray(value) ? JSON.stringify(value) : value);
  }

  if (sets.length === 0) return false;

  sets.push("updated_at = datetime('now')");
  values.push(eventId);

  const stmt = database.prepare(
    `UPDATE events SET ${sets.join(", ")} WHERE id = ?`
  );
  const result = stmt.run(...values);
  return result.changes > 0;
}

export function insertSubscriber(
  id: string,
  email: string,
  unsubscribeToken: string
): { success: true; alreadyExists: boolean } {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT OR IGNORE INTO subscribers (id, email, subscribed_at, is_active, unsubscribe_token)
    VALUES (?, ?, datetime('now'), 1, ?)
  `);
  const result = stmt.run(id, email, unsubscribeToken);
  return { success: true, alreadyExists: result.changes === 0 };
}

export function getActiveSubscribers(): { id: string; email: string; unsubscribe_token: string }[] {
  const database = getDb();
  return database.prepare(
    `SELECT id, email, unsubscribe_token FROM subscribers WHERE is_active = 1`
  ).all() as { id: string; email: string; unsubscribe_token: string }[];
}

export function deactivateSubscriber(token: string): boolean {
  const database = getDb();
  const result = database.prepare(
    `UPDATE subscribers SET is_active = 0 WHERE unsubscribe_token = ? AND is_active = 1`
  ).run(token);
  return result.changes > 0;
}
