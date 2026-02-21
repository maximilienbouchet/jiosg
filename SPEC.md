# SPEC.md — Singapore Events Curation App

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

## 3. Feature Set (V1)

### 3.1 Public Website — Single Page

- **Rolling 7-day window** from today. Always shows "next 7 days" regardless of when you visit
- **← → navigation arrows** to browse previous/future weeks
- **Event cards** displaying:
  - Date (day of week + date, e.g. "SAT 22 FEB")
  - Event title
  - Venue name
  - One-sentence blurb (LLM-generated)
  - Tags as colored pills
  - Link to source/tickets (opens in new tab)
- **Tag filter bar** at top — click a tag to filter events
- **Thumbs up / thumbs down** on each event card (anonymous, no auth required)
- **Empty state** when no events pass the filter: a single cheeky line like "Quiet week. Singapore's charging up." — not an apology, a personality moment
- **Email subscribe** — single email input field, minimal. "Get the list every Thursday." Uses Resend free tier (3,000 emails/month)
- **"Plan Ahead Lah" section** — below the main event feed, above the subscribe form
  - Shows max 3 events that are 2-8 weeks out and worth booking now
  - Admin-flagged only (editorial decision, not algorithmic)
  - Each card shows the actual event date, title, venue, blurb, tags
  - Cards have a left accent border to visually distinguish from the main feed
  - Section header: "PLAN AHEAD LAH" with subtitle "Book first, plan later."
  - Renders nothing when no advance-notice events exist (no empty state)
  - Tag filter does NOT apply to this section
  - Static regardless of week navigation (always anchored to today + 7 days)
  - Events auto-transition to the main feed when their date enters the 7-day window
- **Footer** with one-liner about the project

### 3.2 Admin Panel

- Password-protected route (/admin, simple hardcoded password or env var)
- **Manual event submission:** paste a URL → backend fetches page content → LLM generates blurb + tags → preview → approve/reject/edit → publish
- **Event moderation view:** see all events (scraped + manual), toggle visibility, edit blurbs/tags
- **Feedback dashboard:** see thumbs up/down counts per event (simple table)

### 3.3 Scraping Pipeline

- **4 scrapers** running daily at 3:00 AM SGT via cron:
  1. **Eventbrite Singapore** — filter by Singapore location
  2. **TheKallang.com.sg** — Sports Hub events calendar
  3. **Esplanade.com** — performing arts, concerts, recitals
  4. **SportPlus.sg** — running events, community sports, fitness events
- Scrapers write raw events to database with source, scraped date, raw title, raw description, URL, venue, dates
- **Health check:** if a scraper returns 0 events, log a warning. If 0 events for 3+ days, send an alert email to admin

### 3.4 LLM Pipeline (two separate calls)

**Call 1 — Filter (Claude Haiku):**
- Input: raw event title + description + venue + dates
- System prompt encodes the filtering rules (see Section 6)
- Output: `{ "include": true/false, "reason": "string" }`
- Cost: ~$0.01 per 100 events

**Call 2 — Blurb + Tags (Claude Haiku):**
- Only runs on events that passed the filter
- Input: raw event title + description + venue
- System prompt encodes tone and tag vocabulary (see Section 6)
- Output: `{ "blurb": "One sentence, max 120 chars", "tags": ["tag1", "tag2"] }`
- Cost: ~$0.005 per event

**Total monthly cost estimate:** ~200 raw events/day × 30 days = 6,000 filter calls + ~300 blurb calls = well under $5/month on Haiku.

### 3.5 Email Digest

- Sent every Thursday at 6:00 PM SGT
- Plain, clean HTML email — just the event list with links
- Same content as the website but delivered
- One-click unsubscribe
- Provider: Resend (free tier: 3,000 emails/month, 100/day)

---

## 4. Tags Vocabulary

Fun, short, personality-driven. The tag names are inspired by Pit Viper's approach to labeling — personality over corporate.

| Tag | Used for | Color suggestion |
|-----|----------|-----------------|
| `live & loud` | Concerts, live music, DJ sets | Electric blue |
| `culture fix` | Orchestra, ballet, opera, theatre | Deep purple |
| `go see` | Museum exhibitions, art shows, gallery openings | Warm amber |
| `game on` | Spectator sports, tournaments | Green |
| `screen time` | Film screenings, film festivals | Soft red |
| `taste test` | Wine events, food festivals, tastings, supper clubs | Burgundy |
| `touch grass` | Running events, outdoor activities, active stuff | Lime green |
| `free lah` | No cost events | Gold |
| `last call` | Ending within 7 days | Orange/warning |
| `bring someone` | Great for a date or bringing friends | Pink |
| `once only` | One-time events, limited, rare appearances | White/silver |
| `try lah` | Something outside comfort zone, unexpected | Teal |

Events get 1-3 tags max. LLM assigns them.

---

## 5. Data Model

```
events
├── id                  (UUID, primary key)
├── source              (enum: eventbrite, thekallang, esplanade, sportplus, manual)
├── source_url          (string, original URL)
├── raw_title           (string)
├── raw_description     (text, nullable)
├── venue               (string)
├── event_date_start    (datetime)
├── event_date_end      (datetime, nullable)
├── scraped_at          (datetime)
├── llm_included        (boolean, nullable — null = not yet processed)
├── llm_filter_reason   (string, nullable)
├── blurb               (string, nullable — the one-sentence description)
├── tags                (JSON array of strings, nullable)
├── is_manually_added   (boolean, default false)
├── is_published        (boolean, default false — true after LLM + approval)
├── is_advance_notice   (boolean, default false — admin flag for "plan ahead" events)
├── thumbs_up           (integer, default 0)
├── thumbs_down         (integer, default 0)
├── created_at          (datetime)
├── updated_at          (datetime)

subscribers
├── id                  (UUID, primary key)
├── email               (string, unique)
├── subscribed_at       (datetime)
├── is_active           (boolean, default true)
├── unsubscribe_token   (string, unique)
```

Deduplication: before inserting a scraped event, check if `source_url` already exists. If yes, update raw fields but don't re-run LLM.

---

## 6. LLM Prompts

### Filter Prompt (System)

```
You are a strict event curator for a website that recommends quality cultural and lifestyle events in Singapore to people aged 20-40.

Your job: decide if an event should be INCLUDED or EXCLUDED.

INCLUDE events that are:
- Performing arts: concerts, ballet, orchestra, opera, theatre, dance, comedy
- Exhibitions: museum shows, art exhibitions, gallery openings, photography shows
- Sports: spectator sports events, tournaments, major races (as a viewer or participant)
- Music: live music of any genre (classical, jazz, rock, rap, electronic, indie)
- Film: screenings, film festivals, special cinema events
- Food & drink: wine tastings, food festivals, supper clubs, culinary experiences (not just restaurant openings or happy hours)
- Cultural: author talks, book launches with notable authors, cultural festivals, heritage events
- Active: notable runs, cycling events, outdoor festivals
- Unique one-off experiences that a curious person would find interesting

EXCLUDE events that are:
- Corporate: conferences, networking events, "build your LinkedIn" type meetups, industry summits
- Promotions: bar deals, 1-for-1 offers, happy hours, brand activations that are just ads
- Recurring paid workshops: "make your own candle $200", "pottery class every Saturday" — things that are permanent commercial offerings, not events
- Kids-only: events exclusively for children or families with young kids
- Webinars or online-only events
- MLM, crypto meetups, get-rich-quick seminars
- Generic: "networking mixer", "professionals meetup", vague community gatherings with no specific draw
- Religious services (cultural religious festivals ARE ok)

Respond with JSON only:
{"include": true/false, "reason": "brief explanation"}
```

### Blurb + Tags Prompt (System)

```
You write one-sentence event descriptions for a curated events website in Singapore. Your audience is 20-40 year olds who are culturally curious.

Rules:
- Exactly ONE sentence, maximum 120 characters
- Be specific about what makes this event interesting — don't be generic
- Don't start with "Join us" or "Don't miss" or "Come and"
- State the interesting fact: who is performing, what's being shown, why it's notable
- Tone: informative and slightly warm, not breathless or salesy

Available tags (assign 1-3 that fit best):
live & loud, culture fix, go see, game on, screen time, taste test, touch grass, free lah, last call, bring someone, once only, try lah

Respond with JSON only:
{"blurb": "your one sentence", "tags": ["tag1", "tag2"]}
```

---

## 7. Frontend Design Spec

### Visual Direction

- **Dark mode** — background #0A0A0F (very dark navy-black), text #E8E8ED (warm off-white)
- **One accent color** — electric amber/gold #F5A623 for tags, interactive elements, arrows
- **Secondary accent** — soft blue #6B8AFF for links and hover states
- **Typography-driven design** — the type IS the design, minimal other decoration
- **Fonts:**
  - Display/headings: Space Grotesk (Google Fonts, free) — geometric, modern, slightly techy
  - Body: Inter (Google Fonts, free) — clean, highly readable
- **No images** — pure typography + color + spacing
- **Micro-interactions:** smooth fade/slide when navigating weeks, subtle hover lift on cards, tag pills have slight glow on hover
- **Mobile-first** — most users will visit on phone

### Layout (Top to Bottom)

```
┌─────────────────────────────────────────┐
│  [SITE NAME]              [subscribe]   │  ← sticky header, minimal
├─────────────────────────────────────────┤
│                                         │
│     ←  SAT 22 FEB — FRI 28 FEB  →      │  ← week navigation, centered
│                                         │
├─────────────────────────────────────────┤
│  [live & loud] [culture fix] [go see]   │  ← tag filter bar (horizontal scroll on mobile)
│  [game on] [taste test] [touch grass]   │
├─────────────────────────────────────────┤
│                                         │
│  SAT 22 FEB                             │  ← date header
│  ┌─────────────────────────────────┐    │
│  │ Singapore Smash 2026             │    │
│  │ The Kallang · Infinity Arena     │    │
│  │ World-class table tennis returns │    │
│  │ with $1.55M in prize money.     │    │
│  │ [game on] [bring someone]        │    │
│  │                        👍 👎 →  │    │  ← thumbs + link arrow
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Impressionist Exhibition         │    │
│  │ National Gallery                 │    │
│  │ Monet to Matisse — rare loans   │    │
│  │ from Musée d'Orsay in SG.       │    │
│  │ [go see] [bring someone]         │    │
│  │                        👍 👎 →  │    │
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
│                                         │
│  ─── PLAN AHEAD LAH ───                │
│  Book first, plan later.                │
│                                         │
│  ┃ SAT 15 MAR                           │
│  ┃ Ottolenghi Live                      │
│  ┃ National Library · Auditorium        │
│  ┃ The chef talks fermentation —        │
│  ┃ tickets selling fast.                │
│  ┃ [taste test] [once only]             │
│  ┃                        👍 👎 →      │
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
- Tag bar: horizontal scroll on mobile, wrapping on desktop
- Event cards: full width, stacked

---

## 8. Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Frontend | Next.js (App Router) | SSR for SEO, simple routing, deploys free on Vercel |
| Styling | Tailwind CSS | Fast, utility-first, dark mode built-in |
| Database | SQLite via better-sqlite3 | Zero config, good enough for this scale, file-based |
| Scrapers | Python (requests + BeautifulSoup) | Simple, well-documented, good for HTML parsing |
| JS-heavy scraping | Playwright (Python) | For sites that need JS rendering (Esplanade if needed) |
| LLM | Anthropic Claude Haiku API | Cheapest, fast, good enough for filter + blurb |
| Email | Resend | Free tier (3k/mo), simple API, good deliverability |
| Hosting (frontend) | Vercel | Free tier, auto-deploys from git |
| Hosting (scrapers + cron) | Railway or DigitalOcean ($5/mo droplet) | Runs Python cron jobs |
| Admin auth | Simple env var password check | No auth library needed for solo use |

### Project Structure

```
project-root/
├── CLAUDE.md              ← Claude Code instructions
├── SPEC.md                ← This file (product spec)
├── README.md              ← Project overview
├── package.json
│
├── app/                   ← Next.js App Router
│   ├── page.tsx           ← Main single-page view
│   ├── layout.tsx         ← Root layout (fonts, dark mode, meta)
│   ├── admin/
│   │   └── page.tsx       ← Admin panel
│   ├── api/
│   │   ├── events/
│   │   │   └── route.ts   ← GET events for date range, POST thumbs
│   │   ├── subscribe/
│   │   │   └── route.ts   ← POST email subscribe
│   │   ├── admin/
│   │   │   ├── events/
│   │   │   │   └── route.ts  ← CRUD events, manual submit
│   │   │   └── process-url/
│   │   │       └── route.ts  ← LLM process a pasted URL
│   │   └── cron/
│   │       ├── scrape/
│   │       │   └── route.ts  ← Trigger scraping (called by external cron)
│   │       └── email/
│   │           └── route.ts  ← Trigger weekly email (called by external cron)
│   └── unsubscribe/
│       └── page.tsx       ← Unsubscribe handler
│
├── lib/
│   ├── db.ts              ← SQLite connection + queries
│   ├── llm.ts             ← Claude API calls (filter + blurb)
│   ├── email.ts           ← Resend integration
│   └── scrapers/
│       ├── eventbrite.ts   ← Eventbrite scraper
│       ├── thekallang.ts   ← The Kallang scraper
│       ├── esplanade.ts    ← Esplanade scraper
│       ├── sportplus.ts    ← SportPlus scraper
│       └── index.ts        ← Scraper orchestrator
│
├── components/
│   ├── EventCard.tsx
│   ├── TagFilter.tsx
│   ├── WeekNav.tsx
│   ├── SubscribeForm.tsx
│   └── EmptyState.tsx
│
├── db/
│   ├── schema.sql         ← SQLite schema
│   └── events.db          ← SQLite database file (gitignored)
│
└── scripts/
    └── seed.ts            ← Seed database with test events
```

Note: Scrapers are written in TypeScript (not Python) to keep a single language in the monorepo. Use `cheerio` instead of BeautifulSoup for HTML parsing. This simplifies deployment — everything runs on Vercel (including API routes as serverless functions) and no separate Python server is needed.

---

## 9. Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...          # Claude API key
RESEND_API_KEY=re_...                 # Resend email API key
ADMIN_PASSWORD=your-secret-password    # Admin panel access
CRON_SECRET=your-cron-secret          # Protects cron API routes
SITE_URL=https://your-domain.com      # For email links
```

---

## 10. Build Plan — Weekend-by-Weekend

### Weekend 1: Foundation + One Scraper + Frontend Shell

**Goal:** A working website that shows events from one source with LLM filtering.

Session 1 (Sat morning): Project setup
- Initialize Next.js project with Tailwind + TypeScript
- Set up SQLite database with schema
- Create CLAUDE.md
- Get basic dark-mode layout rendering with placeholder data

Session 2 (Sat afternoon): First scraper + LLM pipeline
- Build TheKallang scraper (simplest source, static HTML)
- Wire up Claude Haiku API for filter + blurb
- Test end-to-end: scrape → filter → blurb → database

Session 3 (Sun morning): Frontend
- EventCard component with real data from DB
- Week navigation (← →) with rolling 7-day window
- Tag filter bar (client-side filtering)
- Empty state
- Mobile responsive

Session 4 (Sun afternoon): Polish + Deploy
- Thumbs up/down functionality
- Basic styling polish
- Deploy to Vercel
- Test on mobile

**Deliverable:** Live website showing Kallang events, filtered and curated. ~60% of final product.

### Weekend 2: More Scrapers + Admin + Email

Session 5: Add Eventbrite + Esplanade scrapers
Session 6: Add SportPlus scraper + deduplication logic
Session 7: Admin panel (URL paste → LLM → publish)
Session 8: Email subscribe + Thursday digest

**Deliverable:** Full V1 with 4 scrapers, admin panel, email digest.

### Weekend 3: Polish + Distribution

Session 9: Frontend polish — animations, micro-interactions, tag colors
Session 10: Scraper health checks + alerting
Session 11: SEO basics (meta tags, OG image, sitemap)
Session 12: Share on Reddit r/singapore, LinkedIn, WhatsApp groups

**Note:** "Plan Ahead Lah" section should be implemented after the core 7-day flow is solid — late Weekend 3 or as a fast follow.

**Deliverable:** Polished product ready for real users.

---

## 11. Success Metrics (3-month horizon)

- 30 returning weekly visitors
- Positive qualitative feedback from at least 10 people
- You personally discover 2+ events per month you wouldn't have found otherwise
- Scrapers running reliably with <1 break per month
- Email list of 50+ subscribers
