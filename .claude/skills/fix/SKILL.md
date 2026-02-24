---
name: fix
description: Pick the highest-priority feedback item and implement the fix
---

# Fix Feedback Item

Find the highest-priority unchecked feedback item and implement it.

## Instructions

1. Read `FEEDBACK.md`.
2. Find the highest-priority unchecked (`- [ ]`) item — scan P1 first, then P2, then P3. Pick the first unchecked item found.
3. If no unchecked triaged items exist, tell the user and suggest running `/triage` first.
4. Display the item and ask the user to confirm this is what they want to fix. If the user says no, let them pick a different item.
5. Enter plan mode to design the implementation.
6. After the plan is approved, implement the fix.
7. Verify the fix works (build check, visual check if UI-related).
8. Update `FEEDBACK.md`:
   - Check off the item (`- [x]`).
   - Move it to the **Done** section with the completion date: `- [x] [YYYY-MM-DD] [TESTER_NAME]: "summary" — fixed YYYY-MM-DD`
9. Commit the changes with a message referencing the feedback item.

## Rules

- Always confirm the item with the user before starting.
- Always enter plan mode for non-trivial fixes.
- Follow all project conventions in CLAUDE.md (code style, no test suites, etc.).
- Run `/qa` after the fix if it touches UI or core logic.
