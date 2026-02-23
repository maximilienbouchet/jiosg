import { createClient, type Client, type InValue } from "@libsql/client";
import fs from "fs";
import path from "path";

let client: Client | null = null;
let dbInitialized = false;

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
  is_duplicate: number;
  duplicate_of: string | null;
  llm_score: number | null;
  thumbs_up: number;
  thumbs_down: number;
  created_at: string;
  updated_at: string;
}

export function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL environment variable is not set");
    }

    client = createClient({ url, authToken });
  }
  return client;
}

export async function initializeDb(): Promise<void> {
  if (dbInitialized) return;

  const db = getClient();
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  // Split schema on semicolons and execute as batch
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await db.batch(statements.map((sql) => ({ sql, args: [] })));

  // Migrations for existing databases
  const columnsResult = await db.execute("SELECT * FROM pragma_table_info('events')");
  const columns = columnsResult.rows as unknown as { name: string }[];

  if (!columns.some((c) => c.name === "is_heads_up")) {
    await db.execute("ALTER TABLE events ADD COLUMN is_heads_up INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((c) => c.name === "llm_score")) {
    await db.execute("ALTER TABLE events ADD COLUMN llm_score INTEGER");
  }
  if (!columns.some((c) => c.name === "is_duplicate")) {
    await db.execute("ALTER TABLE events ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((c) => c.name === "duplicate_of")) {
    await db.execute("ALTER TABLE events ADD COLUMN duplicate_of TEXT");
  }

  dbInitialized = true;
}

export async function getPublishedEvents(startDate: string, endDate: string): Promise<EventRow[]> {
  const db = getClient();
  // Use range comparison on the raw TEXT column so the index is used
  // startDate/endDate are YYYY-MM-DD, event_date_start is ISO datetime
  const result = await db.execute({
    sql: `
      SELECT * FROM events
      WHERE is_published = 1
        AND event_date_start >= ?
        AND event_date_start < date(?, '+1 day')
      ORDER BY event_date_start ASC
    `,
    args: [startDate, endDate],
  });
  return result.rows as unknown as EventRow[];
}

export async function incrementThumbs(eventId: string, direction: "up" | "down"): Promise<boolean> {
  const db = getClient();
  const column = direction === "up" ? "thumbs_up" : "thumbs_down";
  const result = await db.execute({
    sql: `UPDATE events SET ${column} = ${column} + 1, updated_at = datetime('now') WHERE id = ?`,
    args: [eventId],
  });
  return (result.rowsAffected ?? 0) > 0;
}

export async function insertEvent(event: {
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
}): Promise<void> {
  const db = getClient();
  await db.execute({
    sql: `
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
    `,
    args: [
      event.id, event.source, event.source_url, event.raw_title, event.raw_description, event.venue,
      event.event_date_start, event.event_date_end,
      event.llm_included, event.llm_filter_reason, event.blurb, event.tags,
      event.is_manually_added, event.is_published, event.is_heads_up ?? 0,
    ],
  });
}

export async function upsertEvent(event: {
  source: string;
  source_url: string;
  raw_title: string;
  raw_description: string | null;
  venue: string;
  event_date_start: string;
  event_date_end: string | null;
}): Promise<{ inserted: boolean }> {
  const db = getClient();

  const existing = await db.execute({
    sql: "SELECT id FROM events WHERE source_url = ?",
    args: [event.source_url],
  });

  const id = crypto.randomUUID();
  await db.execute({
    sql: `
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
    `,
    args: [
      id, event.source, event.source_url, event.raw_title, event.raw_description, event.venue,
      event.event_date_start, event.event_date_end,
    ],
  });

  return { inserted: existing.rows.length === 0 };
}

export async function getUnprocessedEvents(limit?: number): Promise<EventRow[]> {
  const db = getClient();
  const sql = limit
    ? `SELECT * FROM events WHERE llm_included IS NULL AND is_duplicate = 0 ORDER BY event_date_start ASC LIMIT ?`
    : `SELECT * FROM events WHERE llm_included IS NULL AND is_duplicate = 0 ORDER BY event_date_start ASC`;
  const args: InValue[] = limit ? [limit] : [];
  const result = await db.execute({ sql, args });
  return result.rows as unknown as EventRow[];
}

export async function countUnprocessedEvents(): Promise<number> {
  const db = getClient();
  const result = await db.execute(
    "SELECT COUNT(*) as count FROM events WHERE llm_included IS NULL AND is_duplicate = 0"
  );
  return Number(result.rows[0].count);
}

export async function getUnprocessedNonDuplicateEvents(): Promise<EventRow[]> {
  const db = getClient();
  const result = await db.execute(
    "SELECT * FROM events WHERE llm_included IS NULL AND is_duplicate = 0 ORDER BY event_date_start ASC"
  );
  return result.rows as unknown as EventRow[];
}

export async function getPotentialDuplicateTargets(minDate: string, maxDate: string): Promise<EventRow[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `
      SELECT * FROM events
      WHERE is_duplicate = 0
        AND date(event_date_start) BETWEEN date(?, '-7 days') AND date(?, '+7 days')
    `,
    args: [minDate, maxDate],
  });
  return result.rows as unknown as EventRow[];
}

export async function markAsDuplicate(eventId: string, canonicalId: string): Promise<void> {
  const db = getClient();
  await db.execute({
    sql: "UPDATE events SET is_duplicate = 1, duplicate_of = ?, updated_at = datetime('now') WHERE id = ?",
    args: [canonicalId, eventId],
  });
}

export async function updateEventLlmResults(
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
): Promise<void> {
  const db = getClient();
  await db.execute({
    sql: `
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
    `,
    args: [
      data.llm_included,
      data.llm_filter_reason,
      data.blurb,
      data.tags ? JSON.stringify(data.tags) : null,
      data.is_published,
      data.is_heads_up ?? 0,
      data.llm_score ?? null,
      eventId,
    ],
  });
}

export async function getHeadsUpEvents(todaySgt: string): Promise<EventRow[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `
      SELECT * FROM events
      WHERE is_heads_up = 1
        AND is_published = 1
        AND event_date_start > date(?, '+7 days')
      ORDER BY event_date_start ASC
      LIMIT 3
    `,
    args: [todaySgt],
  });
  return result.rows as unknown as EventRow[];
}

export async function getAllEvents(): Promise<EventRow[]> {
  const db = getClient();
  const result = await db.execute("SELECT * FROM events ORDER BY event_date_start DESC");
  return result.rows as unknown as EventRow[];
}

export async function getEventById(eventId: string): Promise<EventRow | undefined> {
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM events WHERE id = ?",
    args: [eventId],
  });
  return (result.rows[0] as unknown as EventRow) ?? undefined;
}

const ALLOWED_UPDATE_COLUMNS = new Set([
  "raw_title", "venue", "blurb", "tags",
  "is_published", "is_heads_up", "is_duplicate", "llm_score",
  "event_date_start", "event_date_end",
]);

export async function updateEvent(
  eventId: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const db = getClient();
  const sets: string[] = [];
  const values: InValue[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_UPDATE_COLUMNS.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push((key === "tags" && Array.isArray(value) ? JSON.stringify(value) : value) as InValue);
  }

  if (sets.length === 0) return false;

  sets.push("updated_at = datetime('now')");
  values.push(eventId);

  const result = await db.execute({
    sql: `UPDATE events SET ${sets.join(", ")} WHERE id = ?`,
    args: values,
  });
  return (result.rowsAffected ?? 0) > 0;
}

export async function insertSubscriber(
  id: string,
  email: string,
  unsubscribeToken: string
): Promise<{ success: true; alreadyExists: boolean }> {
  const db = getClient();
  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO subscribers (id, email, subscribed_at, is_active, unsubscribe_token)
      VALUES (?, ?, datetime('now'), 1, ?)
    `,
    args: [id, email, unsubscribeToken],
  });
  return { success: true, alreadyExists: (result.rowsAffected ?? 0) === 0 };
}

export async function getActiveSubscribers(): Promise<{ id: string; email: string; unsubscribe_token: string }[]> {
  const db = getClient();
  const result = await db.execute(
    "SELECT id, email, unsubscribe_token FROM subscribers WHERE is_active = 1"
  );
  return result.rows as unknown as { id: string; email: string; unsubscribe_token: string }[];
}

export interface ScraperRunRow {
  id: string;
  source: string;
  events_found: number;
  error: string | null;
  ran_at: string;
}

export async function insertScraperRun(run: {
  source: string;
  events_found: number;
  error: string | null;
}): Promise<void> {
  const db = getClient();
  await db.execute({
    sql: `
      INSERT INTO scraper_runs (id, source, events_found, error, ran_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `,
    args: [crypto.randomUUID(), run.source, run.events_found, run.error],
  });
}

export async function getRecentScraperRuns(days = 7): Promise<ScraperRunRow[]> {
  const db = getClient();
  const result = await db.execute({
    sql: `
      SELECT * FROM scraper_runs
      WHERE ran_at >= datetime('now', ? || ' days')
      ORDER BY ran_at DESC
    `,
    args: [`-${days}`],
  });
  return result.rows as unknown as ScraperRunRow[];
}

export async function deactivateSubscriber(token: string): Promise<boolean> {
  const db = getClient();
  const result = await db.execute({
    sql: "UPDATE subscribers SET is_active = 0 WHERE unsubscribe_token = ? AND is_active = 1",
    args: [token],
  });
  return (result.rowsAffected ?? 0) > 0;
}
