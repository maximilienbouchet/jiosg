---
name: add-feedback
description: Parse raw messy feedback and add structured items to FEEDBACK.md inbox
---

# Add Feedback

You are given raw, messy feedback from a tester. Parse `$ARGUMENTS` into structured feedback items.

## Instructions

1. Read `$ARGUMENTS` — this is raw feedback (could be a paste from WhatsApp, Telegram, email, voice note transcript, or bullet points).
2. Extract each distinct piece of feedback as a separate item.
3. For each item, write a clear one-line summary (keep the tester's intent, drop filler words).
4. Read `FEEDBACK.md` and append each item to the **Inbox** section in this format:
   ```
   - [ ] [YYYY-MM-DD] [TESTER_NAME]: "summary of feedback"
   ```
   - Use today's date.
   - If the tester's name is obvious from context, use it. Otherwise use "Anon".
   - The summary should be a concise, actionable sentence in the tester's voice.
5. Print a summary of what was added (count + list).

## Rules

- Do NOT triage, prioritize, or move items — just add to Inbox.
- Do NOT modify any other section of FEEDBACK.md.
- If `$ARGUMENTS` is empty, ask the user to paste or type the feedback.
