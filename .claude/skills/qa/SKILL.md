# /qa — End-of-Session QA Check

Run this skill at the end of each development session to verify nothing is broken.

## Instructions

You are running a manual QA pass on the sg-event-curation app. Use conversation context to understand what was changed this session, and verify everything still works.

### Step 1: Read SPEC.md for expected behavior

Read SPEC.md to understand what pages and API routes should exist.

### Step 2: Smoke tests — lint and build

Run these and report pass/fail:

```bash
npm run lint
npm run build
```

If either fails, stop and report the errors.

### Step 3: Start dev server

Check if the dev server is already running on port 3000. If not, start it in the background:

```bash
npm run dev
```

Wait for it to be ready before continuing.

### Step 4: Visual verification with Playwright MCP

Navigate to each page and take a screenshot into `test-screenshots/`. Use descriptive filenames with timestamps.

**Pages to check:**
1. Homepage (`http://localhost:3000`) — verify event cards render, tag filter bar visible, week navigation works
2. Admin panel (`http://localhost:3000/admin`) — verify it loads (may require password)

For each page:
- Take a screenshot (save to `test-screenshots/`)
- Check browser console for errors using `browser_console_messages`
- Report any rendering issues visible in the snapshot

### Step 5: API route verification

Use curl to hit API routes and verify response shapes:

```bash
# Events API — should return JSON array
curl -s http://localhost:3000/api/events | head -c 500

# Subscribe API — should accept POST with email
curl -s -X POST http://localhost:3000/api/subscribe -H "Content-Type: application/json" -d '{"email":"test@example.com"}'
```

Report the response status and shape (don't worry about specific data).

### Step 6: Summary

Output a summary table:

```
## QA Summary

| Check              | Status |
|--------------------|--------|
| Lint               | PASS/FAIL |
| Build              | PASS/FAIL |
| Homepage renders   | PASS/FAIL |
| Admin renders      | PASS/FAIL |
| Console errors     | NONE/list them |
| Events API         | PASS/FAIL |
| Subscribe API      | PASS/FAIL |

Screenshots saved to test-screenshots/
```

If anything failed, list specific errors and suggest fixes.