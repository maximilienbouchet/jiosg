import { NextRequest } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getPublishedEvents, getClient, initializeDb, getHeadsUpEvents, getEventsByTag, getEventById } from "../../../lib/db";
import type { EventRow } from "../../../lib/db";
import { addDays, formatDateHeader } from "../../../lib/dates";
import { ALL_TAGS } from "../../../lib/tags";

function getTodaySgt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

function getUpcomingFriday(todaySgt: string): string {
  const d = new Date(todaySgt + "T00:00:00");
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (day === 5 || day === 6) {
    // Fri or Sat — use this week's Friday
    const diff = day - 5;
    d.setDate(d.getDate() - diff);
  } else if (day === 0) {
    // Sunday — advance to next Friday
    d.setDate(d.getDate() + 5);
  } else {
    // Mon–Thu — advance to upcoming Friday
    d.setDate(d.getDate() + (5 - day));
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatEvent(row: EventRow): string {
  const date = formatDateHeader(row.event_date_start);
  const title = row.raw_title;
  const venue = row.venue;
  const description =
    row.blurb ||
    row.enriched_description ||
    (row.raw_description || "").slice(0, 500);
  let tags = "";
  try {
    const parsed = JSON.parse(row.tags || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      tags = `Tags: ${parsed.join(", ")}`;
    }
  } catch {
    // ignore malformed tags
  }
  const link = row.source_url;

  return [date, title, venue, description, tags, link]
    .filter(Boolean)
    .join("\n");
}

const handler = createMcpHandler(
  async (server) => {
    server.tool(
      "get_weekend_events",
      "Get curated events happening in Singapore this coming weekend (Friday\u2013Sunday). Filters out corporate noise, MLM, kids workshops, and duplicates. Returns genuinely interesting activities \u2014 concerts, exhibitions, food events, sports, theatre, and more. Optionally filter by category like 'live & loud', 'culture fix', 'taste test', 'touch grass', etc.",
      {
        category: z
          .string()
          .optional()
          .describe(
            "Filter by tag, e.g. 'live & loud', 'culture fix', 'taste test'"
          ),
      },
      async ({ category }) => {
        try {
          await initializeDb();

          const todaySgt = getTodaySgt();
          const friday = getUpcomingFriday(todaySgt);
          const sunday = addDays(friday, 2);

          let events: EventRow[];

          if (category) {
            const db = getClient();
            const pattern = `%"${category}"%`;
            const result = await db.execute({
              sql: `SELECT * FROM events
                    WHERE is_published = 1 AND llm_included = 1 AND is_duplicate = 0
                      AND event_date_start >= ? AND event_date_start <= ?
                      AND tags LIKE ?
                    ORDER BY event_date_start ASC`,
              args: [friday, sunday, pattern],
            });
            events = result.rows as unknown as EventRow[];
          } else {
            const rows = await getPublishedEvents(friday, sunday);
            events = rows.filter(
              (r) => r.llm_included === 1 && r.is_duplicate === 0
            );
          }

          if (events.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No curated events found for this weekend.",
                },
              ],
            };
          }

          const header = `${events.length} curated event${events.length === 1 ? "" : "s"} for ${formatDateHeader(friday)} \u2013 ${formatDateHeader(sunday)}:\n`;
          const text =
            header + events.map((e) => formatEvent(e)).join("\n\n---\n\n");

          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching weekend events: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      "search_events",
      "Search for upcoming curated events in Singapore by keyword. Searches across event titles, descriptions, venues, and tags. Only returns quality-filtered events \u2014 no corporate stuff, no spam. Results sorted by date.",
      {
        query: z.string().describe("Search keyword"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default 10)"),
      },
      async ({ query, limit }) => {
        try {
          await initializeDb();

          const todaySgt = getTodaySgt();
          const effectiveLimit = limit ?? 10;
          const pattern = `%${query}%`;

          const db = getClient();
          const result = await db.execute({
            sql: `SELECT * FROM events
                  WHERE is_published = 1 AND llm_included = 1 AND is_duplicate = 0
                    AND event_date_start >= ?
                    AND (raw_title LIKE ? OR enriched_description LIKE ? OR raw_description LIKE ? OR venue LIKE ? OR tags LIKE ?)
                  ORDER BY event_date_start ASC
                  LIMIT ?`,
            args: [
              todaySgt,
              pattern,
              pattern,
              pattern,
              pattern,
              pattern,
              effectiveLimit,
            ],
          });

          const events = result.rows as unknown as EventRow[];

          if (events.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No upcoming events found matching "${query}".`,
                },
              ],
            };
          }

          const header = `Found ${events.length} event${events.length === 1 ? "" : "s"} matching "${query}":\n`;
          const text =
            header + events.map((e) => formatEvent(e)).join("\n\n---\n\n");

          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error searching events: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      "get_week_events",
      "Get the main jio feed — curated events in Singapore for the next 7 rolling days from today. This is the core website experience. Optionally filter by category tag like 'live & loud', 'culture fix', 'taste test', 'touch grass', etc.",
      {
        category: z
          .string()
          .optional()
          .describe(
            "Filter by tag, e.g. 'live & loud', 'culture fix', 'taste test'"
          ),
      },
      async ({ category }) => {
        try {
          await initializeDb();

          const todaySgt = getTodaySgt();
          const endDate = addDays(todaySgt, 6);

          let events: EventRow[];

          if (category) {
            const db = getClient();
            const pattern = `%"${category}"%`;
            const result = await db.execute({
              sql: `SELECT * FROM events
                    WHERE is_published = 1 AND llm_included = 1 AND is_duplicate = 0
                      AND event_date_start >= ? AND event_date_start <= ?
                      AND tags LIKE ?
                    ORDER BY event_date_start ASC`,
              args: [todaySgt, endDate, pattern],
            });
            events = result.rows as unknown as EventRow[];
          } else {
            const rows = await getPublishedEvents(todaySgt, endDate);
            events = rows.filter(
              (r) => r.llm_included === 1 && r.is_duplicate === 0
            );
          }

          if (events.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: category
                    ? `No curated events matching "${category}" in the next 7 days.`
                    : "Quiet week. Singapore's charging up.",
                },
              ],
            };
          }

          const header = `${events.length} curated event${events.length === 1 ? "" : "s"} for ${formatDateHeader(todaySgt)} – ${formatDateHeader(endDate)}:\n`;
          const text =
            header + events.map((e) => formatEvent(e)).join("\n\n---\n\n");

          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching week events: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      "get_heads_up_events",
      "Get 'Mark Your Calendar' events — notable upcoming events beyond the 7-day window that are worth booking now. These are LLM-selected highlights for forward planning.",
      {
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max results (default 20)"),
      },
      async ({ limit }) => {
        try {
          await initializeDb();

          const todaySgt = getTodaySgt();
          const effectiveLimit = limit ?? 20;

          const rows = await getHeadsUpEvents(todaySgt);
          const events = rows
            .filter((r) => r.llm_included === 1 && r.is_duplicate === 0)
            .slice(0, effectiveLimit);

          if (events.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No heads-up events to flag right now.",
                },
              ],
            };
          }

          const header = `${events.length} event${events.length === 1 ? "" : "s"} worth booking ahead:\n`;
          const text =
            header + events.map((e) => formatEvent(e)).join("\n\n---\n\n");

          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching heads-up events: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      "get_events_by_tag",
      `Browse upcoming curated events by tag. Valid tags: ${ALL_TAGS.join(", ")}`,
      {
        tag: z.string().describe("Tag to filter by, e.g. 'live & loud'"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default 10)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Offset for pagination (default 0)"),
      },
      async ({ tag, limit, offset }) => {
        try {
          await initializeDb();

          const normalizedTag = tag.toLowerCase();
          if (!ALL_TAGS.includes(normalizedTag as typeof ALL_TAGS[number])) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid tag "${tag}". Valid tags are: ${ALL_TAGS.join(", ")}`,
                },
              ],
              isError: true,
            };
          }

          const todaySgt = getTodaySgt();
          const effectiveLimit = limit ?? 10;
          const effectiveOffset = offset ?? 0;

          const rows = await getEventsByTag(
            normalizedTag,
            todaySgt,
            effectiveLimit,
            effectiveOffset
          );
          const events = rows.filter(
            (r) => r.llm_included === 1 && r.is_duplicate === 0
          );

          if (events.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No upcoming events tagged "${normalizedTag}".`,
                },
              ],
            };
          }

          const header = `${events.length} upcoming "${normalizedTag}" event${events.length === 1 ? "" : "s"}:\n`;
          const text =
            header + events.map((e) => formatEvent(e)).join("\n\n---\n\n");

          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching events by tag: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    server.tool(
      "get_event_details",
      "Get full details for a single event by its ID. Returns extended description, dates, venue, tags, and source link.",
      {
        event_id: z.string().describe("The event UUID"),
      },
      async ({ event_id }) => {
        try {
          await initializeDb();

          const event = await getEventById(event_id);

          if (
            !event ||
            event.is_published !== 1 ||
            event.llm_included !== 1 ||
            event.is_duplicate !== 0
          ) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Event not found.",
                },
              ],
            };
          }

          const date = formatDateHeader(event.event_date_start);
          const endDate = event.event_date_end
            ? ` – ${formatDateHeader(event.event_date_end)}`
            : "";
          const description =
            event.enriched_description ||
            event.blurb ||
            (event.raw_description || "").slice(0, 2000);
          let tags = "";
          try {
            const parsed = JSON.parse(event.tags || "[]");
            if (Array.isArray(parsed) && parsed.length > 0) {
              tags = `Tags: ${parsed.join(", ")}`;
            }
          } catch {
            // ignore malformed tags
          }

          const parts = [
            event.raw_title,
            `${date}${endDate}`,
            event.venue,
            "",
            description,
            tags,
            "",
            `Source: ${event.source}`,
            event.source_url,
          ].filter((line) => line !== undefined);

          return {
            content: [{ type: "text" as const, text: parts.join("\n") }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching event details: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  },
  { serverInfo: { name: "jio-events", version: "1.0.0" } },
  { basePath: "/api" }
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mcpGet = handler as any;

async function GET(req: NextRequest, ctx: Record<string, unknown>) {
  const isMcpPath = new URL(req.url).pathname === "/api/mcp";
  const wantsSSE = req.headers.get("accept")?.includes("text/event-stream");
  if (isMcpPath && !wantsSSE) {
    return new Response(
      JSON.stringify({
        name: "jio-events",
        version: "1.0.0",
        status: "ok",
        tools: ["get_weekend_events", "search_events", "get_week_events", "get_heads_up_events", "get_events_by_tag", "get_event_details"],
        usage: 'Add to Claude Desktop config: { "mcpServers": { "jio-events": { "url": "https://<your-domain>/api/mcp" } } }',
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  return mcpGet(req, ctx);
}

export { GET, handler as POST, handler as DELETE };
export const maxDuration = 60;
