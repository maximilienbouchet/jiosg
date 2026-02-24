# Feedback Tracker

## Inbox
<!-- Raw feedback lands here via /add-feedback -->

## Triaged

### P1 — Must fix (blocks testers or breaks core flow)
- [x] [2026-02-24] Anon: "Rolling week window (Mon-Sun, Tue-Mon...) is cognitively hard to navigate — want standard week boundaries"
- [x] [2026-02-24] Anon: "Thumbs up vote cannot be undone — should be toggleable"
- [x] [2026-02-23] Anon2: "Week start day is inconsistent (starts on Tuesday, then Sunday) — should be a standard fixed order"
- [x] [2026-02-23] Anon2: "The external link arrow is too small and not obvious — clicked the event card expecting a detail page but nothing happened, only later found the tiny arrow"
- [x] [2026-02-24] Anon: "The full event card should be clickable, not just the small arrow — the arrow is frustrating"

### P2 — Should fix (degrades experience but workaround exists)
- [ ] [2026-02-24] Anon: "Multi-day events only appear on one day — e.g. the badminton tournament spans multiple days but shows up on a single date"
- [ ] [2026-02-24] Anon: "Show start time, duration, and price on event cards so I can quickly filter what fits my schedule and budget"
- [ ] [2026-02-23] Anon2: "If you have many events in a week, you have to scroll far to reach Saturday — add day-of-week quick-filter buttons (Mon, Tue... Sat) above the event list"
- [ ] [2026-02-23] Anon2: "Clicking a tag on an event card should filter by that tag (like clicking a category pill)"
- [ ] [2026-02-23] Anon2: "No time-of-day info on events — want to know if it's a morning, afternoon, or evening event to plan my day"
- [x] [2026-02-23] Alexandre: "Add Peatix as a source — has events like Ice Cream Sundays that would fit well"
- [x] [2026-02-23] Anirudh: "Add Ticketek and Fever as event sources"
- [x] [2026-02-23] Lucas: "Add Tessera as an event source"

### P3 — Nice to have (polish, minor annoyances)
- [ ] [2026-02-24] Anon: "Add a calendar/date picker so I can jump to a specific date instead of scrolling through weeks"
- [ ] [2026-02-24] Anon: "Add geographic zone filter (central, east, west) so I can find events near me"
- [ ] [2026-02-23] Anon2: "Too many Eventbrite events, not enough from other sources — wants more source diversity"

### Won't do (out of scope or intentional)
- [ ] [2026-02-24] Anon: "Tag names are unclear (live & loud, bring someone) — want more intuitive categories like Art/Music/Comedy or Date-friendly/Group-friendly"
- [ ] [2026-02-24] Anon: "Add ability to save events to a list and share that list with someone (like Airbnb saved places or GrabFood group orders)"
- [ ] [2026-02-23] Anon2: "Add a map view to see events by location (like Booking.com)"
- [ ] [2026-02-23] Anon2: "Add ability to block/hide a venue or artist you don't like (long-press or block button on event card)"
- [ ] [2026-02-23] Anon2: "Add an LLM-powered conversational search — e.g. 'I need a group outing for 4 people who like sports'"
- [ ] [2026-02-23] Anon2: "Collaborative recommendations — 'users who liked this event also liked...' (needs accounts)"
- [ ] [2026-02-23] Anon2: "Consider one-day-per-page layout with expandable time slots (morning/afternoon/evening) and swipe to change day"
- [ ] [2026-02-23] Anon2: "Background is too dark — would prefer a lighter option"

## Done
<!-- Completed items moved here with date -->
- [x] [2026-02-24] "External link arrow too small" + "Full card should be clickable" — Fixed: entire event card is now a clickable link, removed tiny arrow, vote buttons still work independently
- [x] [2026-02-24] "Rolling week window is cognitively hard to navigate" + "Week start day is inconsistent" — Fixed: default view shows today→Sunday, all other weeks Mon→Sun
- [x] [2026-02-24] "Thumbs up vote cannot be undone" — Fixed: votes are now toggleable (undo, switch direction), persisted in localStorage
- [x] [2026-02-24] "Add Peatix as a source" + "Add Fever as event source" + "Add Tessera as an event source" — Added: three new JSON API scrapers (Peatix, Fever, Tessera) with pre-filtering, rate limiting, and admin panel integration
