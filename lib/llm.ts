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

const FILTER_SYSTEM_PROMPT = `You are a strict event curator for a website that recommends quality cultural and lifestyle events in Singapore to people aged 20-40.

Your job: decide if an event should be INCLUDED or EXCLUDED.

IMPORTANT: Apply "the Saturday test" — would a culturally curious couple genuinely consider this specific event over other options that weekend? Routine, generic, or unremarkable events should be EXCLUDED even if they fit a category below.

INCLUDE events that are:
- Performing arts: concerts, ballet, orchestra, opera, theatre, dance, comedy — BUT ONLY if featuring notable performers, special productions, premieres, or limited runs
- Exhibitions: museum shows, art exhibitions, gallery openings, photography shows — BUT ONLY if it's a significant or noteworthy exhibition
- Sports: spectator sports events, tournaments, major races (as a viewer or participant) — NOT routine league matches
- Music: live music of any genre (classical, jazz, rock, rap, electronic, indie) — BUT ONLY notable acts, festivals, or special events
- Film: screenings, film festivals, special cinema events — NOT regular movie showings
- Food & drink: wine tastings, food festivals, supper clubs, culinary experiences — NOT just restaurant openings or happy hours
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
- Routine recurring performances: weekly jazz nights, standing comedy open mics, regular concert series at the same venue — unless featuring a notable guest
- Generic performing arts with no notable draw: small recitals, student showcases, unknown artist solo shows — unless genuinely interesting
- Standard venue programming: regular rotating schedule, not special occasions
- Free community performances with vague descriptions and no clear artistic draw

Respond with JSON only:
{"include": true/false, "reason": "brief explanation"}`;

const BLURB_SYSTEM_PROMPT = `You write one-sentence event descriptions for a curated events website in Singapore. Your audience is 20-40 year olds who are culturally curious.

Rules:
- Exactly ONE sentence, maximum 120 characters
- Be specific about what makes this event interesting — don't be generic
- Don't start with "Join us" or "Don't miss" or "Come and"
- State the interesting fact: who is performing, what's being shown, why it's notable
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
1-3: Routine, could happen any week
4-5: Decent, worth knowing about
6-7: Good, would recommend to friends
8-10: Must-see, notable performer/exhibition, don't miss

Be honest and sparing with high scores. Most events should score 4-6.

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
      blurb: String(parsed.blurb).slice(0, 120),
      tags: validTags.length > 0 ? validTags : [],
      headsUp: Boolean(parsed.heads_up),
      score,
    };
  } catch (error) {
    console.error("generateBlurbAndTags parse/API error:", error);
    return {
      blurb:
        rawTitle.length > 120 ? rawTitle.slice(0, 117) + "..." : rawTitle,
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

const SCORE_THRESHOLD = 6;
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
    updateEventLlmResults(event.id, {
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

  updateEventLlmResults(event.id, {
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

  const dedupResult = runDeduplication();
  if (dedupResult.marked > 0) {
    console.log(`[dedup] Marked ${dedupResult.marked} duplicate(s)`);
    for (const pair of dedupResult.pairs) {
      console.log(`  "${pair.duplicateTitle}" -> dup of "${pair.canonicalTitle}"`);
    }
  }

  const events = getUnprocessedEvents(limit);
  const totalUnprocessed = countUnprocessedEvents();
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
