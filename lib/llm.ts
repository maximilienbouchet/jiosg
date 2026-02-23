import Anthropic from "@anthropic-ai/sdk";
import { ALL_TAGS } from "./tags";
import { getUnprocessedEvents, countUnprocessedEvents, updateEventLlmResults, type EventRow } from "./db";
import { runDeduplication } from "./dedup";

const MODEL = "claude-haiku-4-5-20251001";

const anthropic = new Anthropic();

export interface FilterResult {
  include: boolean;
  reason: string;
}

export interface BlurbResult {
  blurb: string;
  tags: string[];
  headsUp: boolean;
  score: number;
}

const FILTER_SYSTEM_PROMPT = `You are an extremely selective event curator for a website that recommends only the BEST cultural and lifestyle events in Singapore to people aged 20-40.

Your job: decide if an event should be INCLUDED or EXCLUDED. When in doubt, EXCLUDE. We show ~10 events per week max — only the genuinely exciting ones make the cut.

CRITICAL: Apply "the wow test" — would a culturally curious person see this and think "oh wow, I need to go to this"? If the answer is "maybe" or "it's fine", EXCLUDE it. We only want events that make people text their friends.

INCLUDE events that are:
- Performing arts: concerts, ballet, orchestra, opera, theatre, dance, comedy — ONLY if featuring internationally or regionally recognized performers, award-winning productions, premieres, or genuinely rare appearances
- Exhibitions: museum shows, art exhibitions — ONLY if featuring major artists, landmark collections, international loans, or critically acclaimed work
- Sports: major tournaments, championship events, international competitions — NOT local league matches or routine fixtures
- Music: live music — ONLY headliner-level acts, major festivals, or genuinely notable performances (not every local band gig)
- Film: premieres, major film festivals, director Q&As with notable filmmakers — NOT regular screenings or small indie series
- Food & drink: food festivals, celebrity chef events, unique culinary experiences — NOT generic wine tastings or routine supper clubs
- Cultural: talks by internationally known authors/speakers, major cultural festivals — NOT every book launch or small talk
- Active: marquee races (marathon, triathlon), major outdoor festivals — NOT every fun run or community jog
- Truly unique one-off experiences that would be hard to replicate

EXCLUDE events that are:
- Corporate: conferences, networking events, industry summits, LinkedIn-type meetups
- Promotions: bar deals, 1-for-1 offers, happy hours, brand activations
- Recurring paid workshops: pottery, candle-making, cooking classes — permanent commercial offerings
- Kids-only: events exclusively for children or families with young kids
- Webinars or online-only events
- MLM, crypto meetups, get-rich-quick seminars
- Generic: networking mixers, vague community gatherings with no specific draw
- Religious services (cultural religious festivals ARE ok)
- Routine recurring performances: weekly jazz nights, open mics, regular venue programming
- Small-scale or unknown acts: local bands without significant following, student showcases, emerging artist solos with no notable draw
- Free community performances with vague descriptions
- Anything where you can't identify a specific, compelling reason someone would choose THIS event over staying home

Respond with JSON only:
{"include": true/false, "reason": "brief explanation"}`;

const BLURB_SYSTEM_PROMPT = `You write one-sentence event descriptions for a curated events website in Singapore. Your audience is 20-40 year olds who are culturally curious.

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
4-5: Decent but not exciting enough to recommend
6: Solid event, would mention if someone asked
7: Good — would actively recommend to friends
8-9: Excellent — would rearrange plans to attend
10: Once-in-a-lifetime, unmissable

Be brutally honest. Most events are a 4-5. Only give 7+ to events with genuinely notable performers, landmark exhibitions, or truly unique experiences. A 7 should make someone think "I should go to this."

Respond with JSON only:
{"blurb": "your one sentence", "tags": ["tag1", "tag2"], "heads_up": true/false, "score": 7}`;

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

export async function filterEvent(
  rawTitle: string,
  rawDescription: string | null,
  venue: string,
  dates: string
): Promise<FilterResult> {
  const userMessage = [
    `Title: ${rawTitle}`,
    `Description: ${rawDescription || "N/A"}`,
    `Venue: ${venue}`,
    `Dates: ${dates}`,
  ].join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: FILTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(extractJson(raw));
    return {
      include: Boolean(parsed.include),
      reason: String(parsed.reason || ""),
    };
  } catch (error) {
    console.error("filterEvent parse/API error:", error);
    return { include: false, reason: "LLM response parse error" };
  }
}

export async function generateBlurbAndTags(
  rawTitle: string,
  rawDescription: string | null,
  venue: string
): Promise<BlurbResult> {
  const userMessage = [
    `Title: ${rawTitle}`,
    `Description: ${rawDescription || "N/A"}`,
    `Venue: ${venue}`,
  ].join("\n");

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: BLURB_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(extractJson(raw));

    const validTags = (parsed.tags as string[])
      .filter((t: string) => (ALL_TAGS as readonly string[]).includes(t))
      .slice(0, 3);

    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore) ? Math.max(1, Math.min(10, Math.round(rawScore))) : 5;

    return {
      blurb: String(parsed.blurb).slice(0, 200),
      tags: validTags.length > 0 ? validTags : [],
      headsUp: Boolean(parsed.heads_up),
      score,
    };
  } catch (error) {
    console.error("generateBlurbAndTags parse/API error:", error);
    return {
      blurb:
        rawTitle.length > 200 ? rawTitle.slice(0, 197) + "..." : rawTitle,
      tags: [],
      headsUp: false,
      score: 5,
    };
  }
}

function formatDateForLlm(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SCORE_THRESHOLD = 7;
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 1000;

async function processSingleEvent(event: EventRow): Promise<"included" | "excluded"> {
  const dateStr = formatDateForLlm(event.event_date_start);
  const endDateStr = event.event_date_end
    ? ` – ${formatDateForLlm(event.event_date_end)}`
    : "";

  const filterResult = await filterEvent(
    event.raw_title,
    event.raw_description,
    event.venue,
    dateStr + endDateStr
  );

  if (!filterResult.include) {
    await updateEventLlmResults(event.id, {
      llm_included: 0,
      llm_filter_reason: filterResult.reason,
      blurb: null,
      tags: null,
      is_published: 0,
      is_heads_up: 0,
      llm_score: null,
    });
    return "excluded";
  }

  const blurbResult = await generateBlurbAndTags(
    event.raw_title,
    event.raw_description,
    event.venue
  );

  await updateEventLlmResults(event.id, {
    llm_included: 1,
    llm_filter_reason: filterResult.reason,
    blurb: blurbResult.blurb,
    tags: blurbResult.tags,
    is_published: blurbResult.score >= SCORE_THRESHOLD ? 1 : 0,
    is_heads_up: blurbResult.headsUp ? 1 : 0,
    llm_score: blurbResult.score,
  });
  return "included";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processUnfilteredEvents(limit = 20): Promise<{
  processed: number;
  included: number;
  excluded: number;
  errors: number;
  remaining: number;
  deduplicated: number;
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const dedupResult = await runDeduplication();
  if (dedupResult.marked > 0) {
    console.log(`[dedup] Marked ${dedupResult.marked} duplicate(s)`);
    for (const pair of dedupResult.pairs) {
      console.log(`  "${pair.duplicateTitle}" -> dup of "${pair.canonicalTitle}"`);
    }
  }

  const events = await getUnprocessedEvents(limit);
  const totalUnprocessed = await countUnprocessedEvents();
  let processed = 0;
  let included = 0;
  let excluded = 0;
  let errors = 0;

  // Process in sub-batches of CONCURRENCY
  for (let i = 0; i < events.length; i += CONCURRENCY) {
    const batch = events.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((event) => processSingleEvent(event))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        processed++;
        if (result.value === "included") included++;
        else excluded++;
      } else {
        console.error("Error processing event:", result.reason);
        errors++;
      }
    }

    // Pace between sub-batches to respect rate limits
    if (i + CONCURRENCY < events.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  const remaining = totalUnprocessed - events.length;

  return { processed, included, excluded, errors, remaining, deduplicated: dedupResult.marked };
}
