import Anthropic from "@anthropic-ai/sdk";
import { ALL_TAGS } from "./tags";
import { getUnprocessedEvents, updateEventLlmResults } from "./db";

const MODEL = "claude-haiku-4-5-20251001";

const anthropic = new Anthropic();

export interface FilterResult {
  include: boolean;
  reason: string;
}

export interface BlurbResult {
  blurb: string;
  tags: string[];
}

const FILTER_SYSTEM_PROMPT = `You are a strict event curator for a website that recommends quality cultural and lifestyle events in Singapore to people aged 20-40.

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

Respond with JSON only:
{"blurb": "your one sentence", "tags": ["tag1", "tag2"]}`;

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

    return {
      blurb: String(parsed.blurb).slice(0, 120),
      tags: validTags.length > 0 ? validTags : [],
    };
  } catch (error) {
    console.error("generateBlurbAndTags parse/API error:", error);
    return {
      blurb:
        rawTitle.length > 120 ? rawTitle.slice(0, 117) + "..." : rawTitle,
      tags: [],
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

export async function processUnfilteredEvents(): Promise<{
  processed: number;
  included: number;
  excluded: number;
  errors: number;
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const events = getUnprocessedEvents();
  let processed = 0;
  let included = 0;
  let excluded = 0;
  let errors = 0;

  for (const event of events) {
    try {
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
        });
        excluded++;
      } else {
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
          is_published: 1,
        });
        included++;
      }

      processed++;
    } catch (error) {
      console.error(`Error processing event ${event.id}:`, error);
      errors++;
    }
  }

  return { processed, included, excluded, errors };
}
