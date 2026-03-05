import { NextRequest } from "next/server";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getPublishedEvents, getClient, initializeDb } from "../../../lib/db";
import type { EventRow } from "../../../lib/db";
import { addDays, formatDateHeader } from "../../../lib/dates";

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
        tools: ["get_weekend_events", "search_events"],
        usage: 'Add to Claude Desktop config: { "mcpServers": { "jio-events": { "url": "https://<your-domain>/api/mcp" } } }',
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  return mcpGet(req, ctx);
}

export { GET, handler as POST, handler as DELETE };
export const maxDuration = 60;
