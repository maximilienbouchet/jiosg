# CLAUDE.md

## Project Overview

Events curation website for Singapore. Single-page app showing ~10 curated events per rolling 7-day window. Automated scraping + LLM filtering + manual curation via admin panel. Dark mode, typographic-driven design.

Brand name: jio (always lowercase)

See @SPEC.md for full product requirements, data model, LLM prompts, and build plan.

## Tech Stack

- **Framework:** Next.js 14+ (App Router), TypeScript
- **Styling:** Tailwind CSS (dark mode, mobile-first)
- **Database:** Turso (libSQL cloud SQLite) via @libsql/client
- **HTML Parsing:** cheerio (for scrapers)
- **LLM:** Anthropic Claude Haiku API (@anthropic-ai/sdk)
- **Email:** Resend
- **Hosting:** Vercel

## Commands

- `npm run dev` — Start dev server (port 3000)
- `npm run build` — Production build
- `npm run lint` — ESLint check
- `npx tsx scripts/seed.ts` — Seed database with test events
- `npx tsx scripts/scrape.ts` — Run all scrapers manually
- `npx tsx scripts/send-test-digest.ts <email>` — Send a test digest email with real DB events

## Code Style

- TypeScript strict mode
- Named exports, not default exports (except Next.js pages)
- Functional components with hooks
- Tailwind utility classes only, no custom CSS files
- Use `cn()` helper from lib/utils.ts for conditional classes (clsx + tailwind-merge)
- Prefer server components. Use "use client" only when interactivity is needed (navigation, data fetching)

## Architecture

- `/app` — Next.js App Router pages and API routes
- `/lib` — Database queries, LLM calls, email, scraper logic
- `/components` — Reusable UI components
- `/db` — SQLite schema file (schema.sql)
- `/scripts` — CLI scripts for seeding, manual scraping

## Key Design Decisions

- Single-page app — all events on one URL, no individual event pages
- Rolling 7-day window from today, not fixed calendar weeks
- Events get 1-3 fun tags (see SPEC.md Section 4 for tag vocabulary)
- LLM pipeline is two separate calls: filter (include/exclude) then blurb+tags generation
- Admin panel is a simple password-protected page, not a full auth system
- Database is hosted on Turso (cloud libSQL) — no local db file needed
- Scrapers run as API routes called by external cron, not as background processes

## QA & Testing

- Run `/qa` at the end of each development session to verify changes
- After building a UI feature, use Playwright MCP to take a screenshot
  and verify the result visually before committing
- Do NOT write automated test suites — manual verification is fine at this scale
- Playwright MCP screenshots go in `test-screenshots/` — NEVER in project root

## Planning Workflow

When entering plan mode, always follow a maker-checker process:
1. **Maker:** Design the implementation plan (explore codebase, draft plan file)
2. **Checker:** After the plan is drafted, ALWAYS spin up a reviewer agent (subagent_type: Plan) acting as a senior engineering manager to:
   - Identify gaps, bugs, edge cases, and over-engineering
   - Flag date/timezone issues, missing validation, import convention mismatches
   - Verify the plan reuses existing utilities and matches project conventions
   - Suggest concrete, actionable improvements ranked by severity
3. **Revise:** Incorporate the reviewer's feedback into the final plan before presenting to the user

## Important Notes

- NEVER commit .env or .env.local files
- Required env vars: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN (for database access)
- The LLM filter prompt in SPEC.md Section 6 is the source of truth for curation rules
- Tags must come from the fixed vocabulary in SPEC.md Section 4 — don't invent new tags
- Event blurbs are ONE sentence, max 120 characters
- Fonts: Space Grotesk (display) + Inter (body) from Google Fonts
- Colors: bg #0A0A0F, text #E8E8ED, accent #F5A623, links #6B8AFF

## Feedback Workflow

Tester feedback flows through three slash commands and the `FEEDBACK.md` tracker:

1. `/add-feedback <raw text>` — Parse messy feedback into structured Inbox items
2. `/triage` — Interactively classify Inbox items into P1/P2/P3/Won't do
3. `/fix` — Pick the highest-priority item, plan, implement, and commit
