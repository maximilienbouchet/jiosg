# jio

A curated events feed for Singapore. Scrapes 10 sources, filters with an LLM, and surfaces ~10 genuinely interesting things happening each week.

**Live at [jiosg.app](https://jiosg.app)**

## Why this exists

Event discovery in Singapore is fragmented. Interesting things — an Ottolenghi talk, a Chinese orchestra performance, a skate festival — are scattered across Eventbrite, Instagram, Telegram groups, and a dozen venue websites, buried under corporate meetups, bar promos, and kids' workshops. Nobody aggregates and filters for taste.

jio scrapes the sources, runs every event through an LLM filter calibrated for culturally curious 20-40 year olds, and publishes what passes. If it's a quiet week, it shows fewer events. Never pads.

## How it works

### Scraping pipeline

10 scrapers run daily, pulling events from:

- **Eventbrite** — general events, Singapore location filter
- **Esplanade** — performing arts, concerts, recitals
- **The Kallang** — Sports Hub events calendar
- **SportPlus** — running events, community sports
- **Peatix** — community and ticketed events
- **Fever** — experience and activity events
- **Tessera** — festival and event listings
- **SCAPE** — urban culture and design
- **SRT** — Singapore Repertory Theatre
- **BookMyShow** — concerts, shows, cinema

Scrapers run in parallel as Vercel serverless functions, triggered by cron. Each run is logged to a `scraper_runs` table with event counts and errors. If any scraper returns zero events, an alert email goes to the admin.

### LLM filtering

Every scraped event goes through two Claude Haiku calls:

1. **Filter** — include or exclude, with a reason. The system prompt encodes strict curation rules: include performing arts, exhibitions, live music, food events, sports, film screenings, unique one-offs. Exclude corporate conferences, bar promos, recurring paid workshops, kids-only events, webinars, MLM meetups, vague community gatherings.

2. **Blurb + tags** — for events that pass, generates a one-sentence description (max 200 chars) and assigns 1-3 tags from a fixed vocabulary of 12. Also scores events 1-10 and flags notable ones as "heads up" for the forward-looking section.

Events with thin descriptions get enriched first — the pipeline fetches the source URL and extracts more context before sending to the LLM.

### Deduplication

Before LLM processing, an algorithmic dedup pass fuzzy-matches events across sources on normalized title + date overlap + venue similarity. No LLM calls — just word-set containment and shared-word thresholds. Duplicates are marked in the DB and skipped by everything downstream.

### Weekly email digest

Every Thursday evening (SGT), active subscribers get a curated digest:

- Events classified as new, ongoing, or ending soon (compared against the previous digest)
- A "Heads Up" section with up to 3 notable events worth booking ahead
- AI-generated subject line and intro paragraph
- One-click unsubscribe

Built on Resend's free tier with rate limiting (600ms between sends).

### MCP server

The same event data is exposed via Model Context Protocol, so AI assistants can query live Singapore events directly. See the next section.

## MCP Server

jio exposes an MCP server at `https://jiosg.app/api/mcp`, letting AI assistants (Claude Desktop, Cursor, custom agents) query curated Singapore events in real time.

### Tools

| Tool | Description |
|------|-------------|
| `get_week_events` | Rolling 7-day curated event feed — the main jio experience |
| `get_weekend_events` | What's on this Friday–Sunday |
| `get_heads_up_events` | Notable events beyond the 7-day window worth booking now |
| `get_events_by_tag` | Browse events by category tag |
| `get_event_details` | Full details for a single event by ID |
| `search_events` | Keyword search across titles, descriptions, venues, and tags |

### Claude Desktop config

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jio-events": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://jiosg.app/api/mcp"]
    }
  }
}
```

Requires Node.js installed locally. `mcp-remote` auto-installs on first run via `npx`.

### Example queries

With the MCP server connected, an AI assistant can handle:

- "What's happening in Singapore this weekend?"
- "Any live music events this week?"
- "Are there any events worth booking ahead?"

## Tech stack

- **Framework:** Next.js 16 (App Router), TypeScript
- **Database:** Turso (cloud libSQL/SQLite)
- **LLM:** Claude Haiku via Anthropic SDK
- **Email:** Resend
- **Scraping:** Cheerio (HTML parsing)
- **MCP:** @modelcontextprotocol/sdk + mcp-handler
- **Hosting:** Vercel (serverless functions + cron)
- **Styling:** Tailwind CSS (dark mode, mobile-first)

## Architecture decisions

**Turso over Supabase/Postgres.** The data model is simple — events, subscribers, logs. SQLite semantics are sufficient, Turso's free tier is generous, and there's no ORM to fight. The entire schema fits in one `.sql` file. For a side project at this scale, managed Postgres is unnecessary overhead.

**Claude Haiku over regex/rules for filtering.** The curation rules are subjective ("would a couple in their 20s genuinely consider doing this on a Saturday?"). Regex can't judge whether a "networking mixer" is worth attending or whether an author talk is notable. Haiku is fast, cheap ($0.01 per 100 events), and handles the nuance that makes the curation useful. The two-call pattern (filter then blurb) keeps each prompt focused and debuggable.

**MCP over a REST API for AI integration.** REST would work fine, but MCP lets AI clients discover and use the tools without custom integration code. Claude Desktop, Cursor, and other MCP-compatible clients can connect with a single config line and immediately query events. The protocol handles tool discovery, schema validation, and streaming. For a data source that's most useful when an AI can reason over it, MCP is the right abstraction.

**Server-side scraping + LLM over user-generated content.** The whole point is taste-filtered curation, not a platform. Letting users submit events would require moderation, spam handling, and a fundamentally different product. Scraping 10 sources and filtering with an LLM produces a better feed with zero community management overhead.

## Status

Live and running daily at [jiosg.app](https://jiosg.app). ~20 email subscribers and growing. 10 scrapers operational, processing ~200 events/day through the LLM pipeline.

## License

MIT
