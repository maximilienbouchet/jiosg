# SPEC.md — jio: Singapore Events Curation App

## 1. Product Overview

**One-liner:** A single-page website showing ~10 curated, quality events happening in Singapore in the next 7 rolling days. Automated scraping + LLM filtering. For culturally curious people aged 20-40 who are tired of digging through noise.

**Core insight:** Singapore has plenty of interesting things happening (Ottolenghi talks, Chinese orchestra performances, skate festivals, ballet, exhibitions) — but they're scattered across a dozen websites buried under corporate events, bar promos, and kids' workshops. Nobody aggregates AND filters for taste.

**Design philosophy:** Show only what's worth someone's time. If it's a quiet week, show fewer events. Never pad. Honesty over volume.

---

## 2. Target User

- Age 20-40, lives in Singapore (expat or local)
- Culturally curious — open to ballet, rap, food festivals, sports, art exhibitions
- Currently discovers events through word of mouth, Instagram, or not at all
- Doesn't want to scroll through 200 Eventbrite listings to find 5 good ones
- Would appreciate being surprised ("I didn't know this was happening")

**The test for every event:** "Would a couple in their 20s-40s genuinely consider doing this on a Saturday?"

---

## 3. Feature Set

### 3.1 Public Website — Single Page

- **Rolling 7-day window** from today. Always shows "next 7 days" regardless of when you visit
- **← → navigation arrows** to browse previous/future weeks
- **Event cards** displaying:
  - Date (day of week + date, e.g. "SAT 22 FEB")
  - Event title (links to source/tickets, opens in new tab)
  - Venue name
  - Date range for multi-day events
  - One-sentence blurb (LLM-generated, max 200 chars)
  - Tags as colored pills (1-3 per event)
- **Empty state** when no events pass the filter: "Quiet week. Singapore's charging up." — not an apology, a personality moment
- **Email subscribe** — single email input field. "Get the list every Thursday." Triggers a welcome email on signup.
- **Footer** with one-liner about the project

### 3.2 Admin Panel

Password-protected route (`/admin`) using `ADMIN_PASSWORD` env var. Five tabs:

1. **Events** — Browse all events (scraped + manual), toggle `is_published` and `is_heads_up`, edit blurbs/tags/scores, view duplicate status
2. **Add Event** — Paste a URL → backend fetches page → LLM generates blurb + tags + score → preview → approve/reject/edit → publish
3. **Scraper Health** — Last 7 days of scraper run history with status indicators (OK / 0 events / Error) per source
4. **Subscribers** — List active subscribers with subscription date
5. **Email Logs** — Recent digest runs with per-subscriber delivery status (sent/failed), Resend message IDs

### 3.3 Scraping Pipeline

**10 scrapers** running daily at 3:00 AM SGT via Vercel cron, all written in TypeScript using cheerio for HTML parsing:

| # | Source | File | What it scrapes |
|---|--------|------|-----------------|
| 1 | Eventbrite Singapore | `eventbrite.ts` | Filtered by Singapore location |
| 2 | The Kallang (Sports Hub) | `thekallang.ts` | Sports Hub events calendar |
| 3 | Esplanade | `esplanade.ts` | Performing arts, concerts, recitals |
| 4 | SportPlus.sg | `sportplus.ts` | Running events, community sports |
| 5 | Peatix | `peatix.ts` | Community events platform |
| 6 | Fever | `fever.ts` | Entertainment & experiences |
| 7 | Tessera | `tessera.ts` | Ticketing platform events |
| 8 | SCAPE | `scape.ts` | Youth & community events |
| 9 | SRT | `srt.ts` | Singapore arts & theatre |
| 10 | BookMyShow | `bookmyshow.ts` | Ticketing platform (SG) |

**Pipeline flow:**
1. Scrapers write raw events to database (source, title, description, URL, venue, dates)
2. **URL-level deduplication:** `ON CONFLICT(source_url)` updates raw fields but skips re-processing
3. **Cross-source deduplication:** Fuzzy-matches events on title + date + venue across sources (`lib/dedup.ts`). Duplicates are marked (`is_duplicate`, `duplicate_of`) and skipped by the LLM pipeline
4. **Description enrichment:** Events with thin descriptions (< 100 chars) get their source URL fetched for richer context before LLM processing (`lib/enrich.ts`)
5. LLM pipeline processes unfiltered events (see Section 3.4)

**Health monitoring:** Each scraper run is logged to `scraper_runs` (source, event count, error, timestamp). If any scraper returns 0 events or errors, an alert email is sent to `ADMIN_EMAIL`.

**Vercel timeout handling:** The cron route supports `?action=scrape` and `?action=process` to split scraping and LLM processing into separate requests, staying under Vercel's 60-second function timeout.

### 3.4 LLM Pipeline

Uses Claude Haiku (`claude-haiku-4-5-20251001`). Two separate calls per event, processed in batches of 5 with rate limiting.

**Call 1 — Filter:**
- Input: raw title + enriched description + venue + dates + source
- Applies a strict "wow test" — can you identify WHAT specifically makes this event worth attending?
- Output: `{ "include": true/false, "reason": "string" }`

**Call 2 — Blurb + Tags + Score + Heads-up (only for included events):**
- Input: raw title + enriched description + venue
- Generates a one-sentence blurb (max 200 chars), assigns 1-3 tags, scores interest 1-10, and flags exceptional events as `heads_up`
- Output: `{ "blurb": "...", "tags": [...], "heads_up": true/false, "score": 7 }`
- **Score threshold:** Events scoring >= 7 are auto-published. Lower-scored events are included but not published (admin can override).
- **Heads-up flag:** Reserved for genuinely exceptional events (notable performer + likely sellout + rare occurrence). Most events should NOT be flagged.

See Section 6 for full prompt text.

### 3.5 Email System

**Weekly Digest** (Thursday 6:00 PM SGT):
- **Context-aware classification:** Events are compared against the previous digest to categorize as:
  - **New** — first appearance in digest
  - **Ongoing** — multi-day events that appeared last week too (rendered as compact single-line rows in a "STILL ON" section)
  - **Ending soon** — multi-day events closing within the digest window (full cards with orange "LAST CHANCE" badge)
- **AI-generated intro:** LLM writes a 2-3 sentence intro paragraph and subject line, focusing on new events and nudging ending-soon ones
- **Heads-up section:** Up to 3 top-scored events beyond the 7-day window, shown at the bottom
- **Promotion rule:** If fewer than 3 new events, highest-scored ongoing events get promoted to full cards
- One-click unsubscribe via unique token
- Rate-limited sending (600ms between emails for Resend free tier)

**Welcome Email** (on subscribe):
- Immediate confirmation with top 2 heads-up events
- Same dark-mode HTML styling as digest

**Pipeline Report Email** (after daily cron):
- Sent to `ADMIN_EMAIL` with scraper results + LLM pipeline stats
- Flags issues: scraper errors, zero-event runs, LLM failures

Provider: Resend (free tier: 3,000 emails/month, 100/day)

---

## 4. Tags Vocabulary

Fun, short, personality-driven. The tag names are inspired by Pit Viper's approach to labeling — personality over corporate.

| Tag | Used for | Color |
|-----|----------|-------|
| `live & loud` | Concerts, live music, DJ sets | `#3B82F6` Electric blue |
| `culture fix` | Orchestra, ballet, opera, theatre | `#9F67FF` Deep purple |
| `go see` | Museum exhibitions, art shows, gallery openings | `#D97706` Warm amber |
| `game on` | Spectator sports, tournaments | `#22C55E` Green |
| `screen time` | Film screenings, film festivals | `#EF4444` Soft red |
| `taste test` | Wine events, food festivals, tastings, supper clubs | `#F2568B` Burgundy-pink |
| `touch grass` | Running events, outdoor activities, active stuff | `#84CC16` Lime green |
| `free lah` | No cost events | `#EAB308` Gold |
| `last call` | Ending within 7 days | `#F97316` Orange |
| `bring someone` | Great for a date or bringing friends | `#EC4899` Pink |
| `once only` | One-time events, limited, rare appearances | `#D1D5DB` Silver |
| `try lah` | Something outside comfort zone, unexpected | `#14B8A6` Teal |

Events get 1-3 tags max. LLM assigns them.

---

## 5. Data Model

```
events
├── id                   (TEXT, UUID primary key)
├── source               (TEXT, one of: eventbrite, thekallang, esplanade, sportplus,
│                          peatix, fever, tessera, scape, srt, bookmyshow, manual)
├── source_url           (TEXT, unique — used for dedup on insert)
├── raw_title            (TEXT)
├── raw_description      (TEXT, nullable)
├── venue                (TEXT)
├── event_date_start     (TEXT, ISO date)
├── event_date_end       (TEXT, nullable — set for multi-day events)
├── scraped_at           (TEXT, datetime)
├── enriched_description (TEXT, nullable — full page content fetched for thin descriptions)
├── llm_included         (INTEGER, nullable — null = not yet processed, 0/1 after)
├── llm_filter_reason    (TEXT, nullable)
├── blurb                (TEXT, nullable — one-sentence description, max 200 chars)
├── tags                 (TEXT, JSON array of strings, nullable)
├── llm_score            (INTEGER, nullable — interest score 1-10)
├── is_manually_added    (INTEGER, default 0)
├── is_published         (INTEGER, default 0 — true when score >= 7 or admin approves)
├── is_heads_up          (INTEGER, default 0 — LLM flag for exceptional events)
├── is_duplicate         (INTEGER, default 0 — algorithmically detected cross-source duplicate)
├── duplicate_of         (TEXT, nullable — references canonical event ID)
├── created_at           (TEXT, datetime)
├── updated_at           (TEXT, datetime)

subscribers
├── id                   (TEXT, UUID primary key)
├── email                (TEXT, unique)
├── subscribed_at        (TEXT, datetime)
├── is_active            (INTEGER, default 1)
├── unsubscribe_token    (TEXT, unique)

scraper_runs
├── id                   (TEXT, UUID primary key)
├── source               (TEXT — scraper name)
├── events_found         (INTEGER, default 0)
├── error                (TEXT, nullable)
├── ran_at               (TEXT, datetime)

digest_runs
├── id                   (TEXT, UUID primary key)
├── ran_at               (TEXT, datetime)
├── subject              (TEXT, nullable — AI-generated subject line)
├── events_count         (INTEGER)
├── heads_up_count       (INTEGER)
├── subscribers_count    (INTEGER)
├── total_sent           (INTEGER)
├── total_failed         (INTEGER)
├── skipped              (TEXT, nullable — reason if digest was skipped)
├── completed_at         (TEXT, nullable — set when all sends finish)

email_logs
├── id                   (TEXT, UUID primary key)
├── digest_run_id        (TEXT, FK → digest_runs)
├── subscriber_id        (TEXT, nullable)
├── email                (TEXT)
├── subject              (TEXT, nullable)
├── resend_message_id    (TEXT, nullable)
├── status               (TEXT, "sent" or "failed")
├── error                (TEXT, nullable)
├── sent_at              (TEXT, datetime)

digest_events
├── id                   (TEXT, UUID primary key)
├── digest_run_id        (TEXT, FK → digest_runs)
├── event_id             (TEXT)
├── category             (TEXT, one of: new, ongoing, ending_soon, heads_up)
├── created_at           (TEXT, datetime)
```

---

## 6. LLM Prompts

### Filter Prompt (System)

```
You are a strict event curator for a website that recommends quality cultural and lifestyle events in Singapore to people aged 20-40.

Your job: decide if an event should be INCLUDED or EXCLUDED. We show ~10 events per week — if it's a quiet week, show fewer; never pad.

Apply "the wow test" — would this genuinely make someone say "oh, I want to go to that"? The key question: can you identify WHAT specifically makes this event worth attending (a named performer, a specific exhibition, a notable race, a unique experience)? If the description is too vague to answer that, EXCLUDE.

When in doubt, EXCLUDE. We'd rather miss a decent event than show a mediocre one.

INCLUDE events that are:
- Performing arts: concerts, ballet, orchestra, opera, theatre, dance, comedy — featuring named performers, specific productions, or limited runs
- Exhibitions: museum shows, art exhibitions, gallery openings, photography shows
- Sports: spectator sports events, tournaments, major races (as a viewer or participant)
- Music: live music of any genre — if there's a named act or a clear draw (festival, notable venue event)
- Film: screenings, film festivals, special cinema events, director Q&As
- Food & drink: wine tastings, food festivals, supper clubs, culinary experiences (not just restaurant openings or happy hours)
- Cultural: author talks, book launches with notable authors, cultural festivals, heritage events
- Active: notable runs, cycling events, outdoor festivals
- Unique one-off experiences that a curious person would find interesting

EXCLUDE events that are:
- Corporate: conferences, networking events, industry summits, LinkedIn-type meetups
- Promotions: bar deals, 1-for-1 offers, happy hours, brand activations that are just ads
- Recurring paid workshops: pottery, candle-making, cooking classes — permanent commercial offerings, not events
- Kids-only: events exclusively for children or families with young kids
- Webinars or online-only events
- MLM, crypto meetups, get-rich-quick seminars
- Generic: networking mixers, vague community gatherings with no specific draw
- Religious services (cultural religious festivals ARE ok)
- Routine recurring programming: weekly jazz nights, open mics, regular venue filler with no specific draw
- Descriptions too vague to identify what makes the event worth attending

Respond with JSON only:
{"include": true/false, "reason": "brief explanation"}
```

### Blurb + Tags + Score Prompt (System)

```
You write one-sentence event descriptions for a curated events website in Singapore. Your audience is 20-40 year olds who are culturally curious.

Rules:
- Exactly ONE sentence, maximum 200 characters
- Structure: start with WHAT the event IS (e.g. "A jazz trio concert...", "An open-air 10K run...", "A photography exhibition..."), then add the specific draw (who, what's special, why it's worth going)
- The reader should immediately understand the format (performance, exhibition, race, festival, screening, tasting, talk, etc.) from the first few words
- Don't start with "Join us", "Don't miss", "Come and", or the event's proper name — lead with the event type
- Tone: informative and slightly warm, not breathless or salesy

Available tags (assign 1-3 that fit best):
live & loud, culture fix, go see, game on, screen time, taste test, touch grass, free lah, last call, bring someone, once only, try lah

Also decide if this event deserves a "heads up" flag — meaning it's genuinely exceptional and worth booking well in advance. This should be rare.

Flag as heads_up ONLY if the event meets at least TWO of:
- Notable performer, artist, or speaker with international or strong regional reputation
- Likely to sell out or has hard capacity constraints (small venue, limited run)
- Rare or one-time occurrence — not a recurring series
- Genuinely unique experience that would be hard to replicate
- Major cultural moment (landmark exhibition, premiere, festival highlight)

Do NOT flag routine events as heads_up, even good ones.

Rate this event's interest from 1-10:
1-3: Routine, could happen any week — skip
4-5: Decent but fairly generic
6: Good event, clear draw — but not exceptional
7: Would text a friend about it unprompted
8-9: Would rearrange plans to attend
10: Once-in-a-lifetime, unmissable

Most events that passed our filter should land at 5-6. Reserve 7+ for events with genuinely notable performers, landmark exhibitions, or truly unique experiences. A 7 means you'd text a friend about it unprompted.

Respond with JSON only:
{"blurb": "your one sentence", "tags": ["tag1", "tag2"], "heads_up": true/false, "score": 7}
```

### Digest Intro Prompt (System)

```
You write weekly email intros for "jio", a curated events newsletter in Singapore for 20-40 year olds. Casual, warm, personality-driven — like texting a friend about what's on this weekend.

Rules:
- Write a 2-3 sentence intro paragraph. Focus on what's NEW this week — name one or two new events specifically.
- If there are ongoing events, briefly acknowledge them ("X is still on at Y until date").
- If there are ending-soon events, nudge readers ("last chance to catch X before it closes Sunday").
- Also write a short email subject line (max 50 chars). It should have personality and mention a specific new event name or draw. No emojis. Lowercase is fine.
- The subject should make someone want to open the email.

Respond with JSON only:
{"intro": "your 2-3 sentences", "subject": "your subject line"}
```

---

## 7. Frontend Design Spec

### Visual Direction

- **Dark mode** — background `#0A0A0F` (very dark navy-black), text `#E8E8ED` (warm off-white)
- **One accent color** — electric amber/gold `#F5A623` for tags, interactive elements, arrows
- **Secondary accent** — soft blue `#6B8AFF` for links and hover states
- **Typography-driven design** — the type IS the design, minimal other decoration
- **Fonts:**
  - Display/headings: Space Grotesk (Google Fonts) — geometric, modern, slightly techy
  - Body: Inter (Google Fonts) — clean, highly readable
- **No images** — pure typography + color + spacing
- **Micro-interactions:** smooth fade/slide when navigating weeks, subtle hover lift on cards, tag pills have slight glow on hover
- **Mobile-first** — most users will visit on phone

### Layout (Top to Bottom)

```
┌─────────────────────────────────────────┐
│  jio                      [subscribe]   │  ← sticky header, minimal
├─────────────────────────────────────────┤
│                                         │
│     ←  SAT 22 FEB — FRI 28 FEB  →      │  ← week navigation, centered
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  SAT 22 FEB                             │  ← date header
│  ┌─────────────────────────────────┐    │
│  │ Singapore Smash 2026             │    │
│  │ The Kallang · Infinity Arena     │    │
│  │ World-class table tennis returns │    │
│  │ with $1.55M in prize money.     │    │
│  │ [game on] [bring someone]        │    │
│  └─────────────────────────────────┘    │
│                                         │
│  SUN 23 FEB                             │  ← next date header
│  ┌─────────────────────────────────┐    │
│  │ ...                              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ─── or if empty ───                    │
│                                         │
│  Quiet week. Singapore's charging up.   │  ← empty state, centered, italic
│  We'll email you when it gets good.     │
│                                         │
├─────────────────────────────────────────┤
│  Get the list every Thursday.           │
│  [email@input________] [→]             │  ← subscribe form
├─────────────────────────────────────────┤
│  Built by a guy who was tired of        │
│  not knowing what's on. Singapore.      │  ← footer, one-liner
└─────────────────────────────────────────┘
```

### Responsive Behavior

- Desktop: max-width 640px centered (reading-width, like a good blog)
- Mobile: full width with 16px padding
- Event cards: full width, stacked

---

## 8. Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Framework | Next.js 14+ (App Router), TypeScript | SSR, simple routing, free Vercel deploy |
| Styling | Tailwind CSS 4 | Fast, utility-first, dark mode built-in |
| Database | Turso (libSQL cloud) via `@libsql/client` | Managed SQLite, no infra to maintain |
| Scrapers | TypeScript + cheerio | Single language, runs as Vercel serverless functions |
| LLM | Anthropic Claude Haiku (`claude-haiku-4-5-20251001`) | Cheap, fast, good enough for filter + blurb |
| Email | Resend | Free tier (3k/mo), simple API, good deliverability |
| Hosting | Vercel (frontend + API routes + cron) | Everything in one place, free tier |
| Admin auth | Simple env var password check | No auth library needed for solo use |
| Analytics | Vercel Analytics + Speed Insights | Built-in, zero config |

### Project Structure

```
project-root/
├── CLAUDE.md                ← Claude Code instructions
├── SPEC.md                  ← This file (product spec)
├── LICENSE                  ← MIT license
├── package.json
│
├── app/                     ← Next.js App Router
│   ├── page.tsx             ← Main single-page view
│   ├── layout.tsx           ← Root layout (fonts, dark mode, meta)
│   ├── admin/
│   │   ├── page.tsx         ← Admin panel (tabbed)
│   │   └── layout.tsx
│   ├── api/
│   │   ├── events/
│   │   │   └── route.ts     ← GET events for date range
│   │   ├── subscribe/
│   │   │   └── route.ts     ← POST email subscribe + welcome email
│   │   ├── admin/
│   │   │   ├── auth/route.ts      ← Admin login/logout
│   │   │   ├── events/route.ts    ← CRUD events
│   │   │   ├── process-url/route.ts ← URL → LLM → preview
│   │   │   └── data/route.ts      ← Stats, health, subscribers, logs
│   │   └── cron/
│   │       ├── scrape-and-process/
│   │       │   └── route.ts  ← Scrape + LLM pipeline (supports ?action= splitting)
│   │       └── email/
│   │           └── route.ts  ← Trigger weekly digest
│   └── unsubscribe/
│       └── page.tsx          ← Unsubscribe handler
│
├── lib/
│   ├── db.ts                ← Turso client, queries, migrations
│   ├── llm.ts               ← Claude API calls (filter + blurb + digest intro)
│   ├── email.ts             ← Resend: digest, welcome, pipeline report emails
│   ├── dates.ts             ← Date utilities, digest window calculation
│   ├── tags.ts              ← Tag vocabulary and color definitions
│   ├── enrich.ts            ← Fetch full event pages for thin descriptions
│   ├── dedup.ts             ← Cross-source fuzzy deduplication
│   ├── digest-classify.ts   ← Context-aware event classification (new/ongoing/ending)
│   ├── admin-auth.ts        ← Cookie-based admin session
│   ├── cron-auth.ts         ← CRON_SECRET validation
│   ├── utils.ts             ← cn() helper (clsx + tailwind-merge)
│   └── scrapers/
│       ├── index.ts          ← Scraper orchestrator
│       ├── eventbrite.ts
│       ├── thekallang.ts
│       ├── esplanade.ts
│       ├── sportplus.ts
│       ├── peatix.ts
│       ├── fever.ts
│       ├── tessera.ts
│       ├── scape.ts
│       ├── srt.ts
│       └── bookmyshow.ts
│
├── components/
│   ├── EventCard.tsx
│   ├── EventsView.tsx
│   ├── WeekNav.tsx
│   ├── SubscribeForm.tsx
│   ├── EmptyState.tsx
│   ├── BackgroundEffect.tsx
│   ├── MouseGlow.tsx
│   └── LayoutEffects.tsx
│
├── db/
│   └── schema.sql            ← Database schema (applied via initializeDb)
│
└── scripts/
    ├── seed.ts                ← Seed database with test events
    ├── scrape.ts              ← Run scrapers manually
    ├── send-test-digest.ts    ← Send test digest to an email
    ├── send-test-welcome.ts   ← Send test welcome email
    ├── send-welcome-existing.ts ← Bulk-send welcome to existing subscribers
    ├── email-preview.ts       ← Generate digest HTML preview
    ├── welcome-email-preview.ts ← Generate welcome HTML preview
    ├── reprocess-blurbs.ts    ← Re-run LLM blurb generation
    ├── reprocess-excluded.ts  ← Re-filter excluded events
    ├── resend-failed.ts       ← Retry failed email sends
    └── inspect-dedup.ts       ← Debug deduplication decisions
```

---

## 9. Environment Variables

```
TURSO_DATABASE_URL=libsql://your-db.turso.io  # Turso database URL
TURSO_AUTH_TOKEN=your-turso-auth-token          # Turso auth token
ANTHROPIC_API_KEY=sk-ant-...                    # Claude API key
RESEND_API_KEY=re_...                           # Resend email API key
FROM_EMAIL=jio <hello@yourdomain.com>           # Email "from" address (with display name)
ADMIN_EMAIL=your@email.com                      # Receives pipeline alert emails
ADMIN_PASSWORD=your-secret-password             # Admin panel access
CRON_SECRET=your-cron-secret                    # Protects cron API routes
SITE_URL=https://your-domain.com                # Public site URL (used in email links)
```
