---
name: triage
description: Interactively triage feedback items from FEEDBACK.md inbox into priority buckets
---

# Triage Feedback

Process unchecked Inbox items in FEEDBACK.md one at a time, interactively with the user.

## Instructions

1. Read `FEEDBACK.md` and `SPEC.md`.
2. Collect all unchecked (`- [ ]`) items in the **Inbox** section.
3. If there are no items, tell the user the inbox is empty and stop.
4. For EACH item, one at a time:
   a. Display the feedback item.
   b. Check if it conflicts with anything in SPEC.md or CLAUDE.md.
   c. Suggest a priority (P1 / P2 / P3 / Won't do) with a brief reason.
   d. Estimate effort: S (< 30 min), M (1-2 hours), L (half day+).
   e. Ask the user to confirm or override the priority.
   f. After user confirms, move the item from Inbox to the correct Triaged subsection in FEEDBACK.md.
5. After all items are processed, print a summary (e.g. "Triaged 4 items: 1 P1, 2 P2, 1 Won't do").

## Rules

- Process items ONE AT A TIME — do not batch.
- Wait for user confirmation before moving each item.
- Keep the item text exactly as written — only move it between sections.
- If the user says "skip", leave the item in Inbox and move to the next.
