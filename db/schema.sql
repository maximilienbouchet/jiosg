CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('eventbrite', 'thekallang', 'esplanade', 'sportplus', 'manual')),
  source_url TEXT NOT NULL,
  raw_title TEXT NOT NULL,
  raw_description TEXT,
  venue TEXT NOT NULL,
  event_date_start TEXT NOT NULL,
  event_date_end TEXT,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  llm_included INTEGER,
  llm_filter_reason TEXT,
  blurb TEXT,
  tags TEXT,
  is_manually_added INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  is_advance_notice INTEGER NOT NULL DEFAULT 0,
  thumbs_up INTEGER NOT NULL DEFAULT 0,
  thumbs_down INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_source_url ON events(source_url);
CREATE INDEX IF NOT EXISTS idx_events_date_start ON events(event_date_start);
CREATE INDEX IF NOT EXISTS idx_events_published ON events(is_published);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1,
  unsubscribe_token TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_subscribers_active ON subscribers(is_active);
CREATE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers(unsubscribe_token);
