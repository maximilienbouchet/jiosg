import { Resend } from "resend";
import {
  initializeDb,
  getPublishedEvents,
  getHeadsUpEvents,
  getActiveSubscribers,
  EventRow,
} from "./db";

const EMAIL_TAG_COLORS: Record<string, string> = {
  "live & loud": "#3B82F6",
  "culture fix": "#7C3AED",
  "go see": "#D97706",
  "game on": "#22C55E",
  "screen time": "#EF4444",
  "taste test": "#9F1239",
  "touch grass": "#84CC16",
  "free lah": "#EAB308",
  "last call": "#F97316",
  "bring someone": "#EC4899",
  "once only": "#D1D5DB",
  "try lah": "#14B8A6",
};

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const dayNum = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${day} ${dayNum} ${month}`;
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const dayNum = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${dayNum} ${month}`;
}

function groupEventsByDate(events: EventRow[]): Map<string, EventRow[]> {
  const groups = new Map<string, EventRow[]>();
  for (const event of events) {
    const dateKey = event.event_date_start.split("T")[0];
    const existing = groups.get(dateKey) || [];
    existing.push(event);
    groups.set(dateKey, existing);
  }
  return groups;
}

function renderTagPill(tag: string): string {
  const color = EMAIL_TAG_COLORS[tag] || "#6B6B76";
  // 25 = ~15% opacity in hex
  const bgColor = color + "25";
  return `<span style="display:inline-block;padding:2px 8px;margin:0 4px 4px 0;border-radius:12px;font-size:11px;font-family:Inter,Arial,sans-serif;color:${color};background-color:${bgColor};border:1px solid ${color}40;">${tag}</span>`;
}

function renderEvent(event: EventRow, isHeadsUp: boolean): string {
  const tags: string[] = event.tags ? JSON.parse(event.tags) : [];
  const tagHtml = tags.map(renderTagPill).join("");
  const venue = event.venue || "";
  const blurb = event.blurb || "";
  const titleColor = event.source_url ? "#6B8AFF" : "#E8E8ED";
  const titleHtml = event.source_url
    ? `<a href="${event.source_url}" style="color:${titleColor};text-decoration:none;font-weight:bold;font-size:16px;font-family:'Space Grotesk',Arial,sans-serif;">${event.raw_title}</a>`
    : `<span style="color:#E8E8ED;font-weight:bold;font-size:16px;font-family:'Space Grotesk',Arial,sans-serif;">${event.raw_title}</span>`;

  const leftBorder = isHeadsUp ? "border-left:3px solid #F5A623;padding-left:12px;" : "";

  return `<tr><td style="padding:0 0 20px 0;${leftBorder}">
    ${titleHtml}<br/>
    <span style="color:#6B6B76;font-size:13px;font-family:Inter,Arial,sans-serif;">${venue}</span><br/>
    <span style="color:#E8E8ED;font-size:14px;font-family:Inter,Arial,sans-serif;">${blurb}</span><br/>
    <div style="margin-top:6px;">${tagHtml}</div>
  </td></tr>`;
}

export function buildDigestHtml(
  events: EventRow[],
  headsUpEvents: EventRow[],
  siteUrl: string,
  unsubscribeToken: string
): string {
  const grouped = groupEventsByDate(events);

  let eventsHtml = "";
  let isFirst = true;
  for (const [dateKey, dateEvents] of grouped) {
    if (!isFirst) {
      eventsHtml += `<tr><td style="padding:8px 0;"><hr style="border:none;border-top:1px solid #1a1a24;"/></td></tr>`;
    }
    isFirst = false;
    eventsHtml += `<tr><td style="padding:16px 0 8px 0;font-family:'Space Grotesk',Arial,sans-serif;font-size:13px;font-weight:bold;color:#F5A623;letter-spacing:1px;">${formatDateHeader(dateKey)}</td></tr>`;
    for (const event of dateEvents) {
      eventsHtml += renderEvent(event, false);
    }
  }

  let headsUpHtml = "";
  if (headsUpEvents.length > 0) {
    headsUpHtml += `<tr><td style="padding:24px 0 4px 0;"><hr style="border:none;border-top:1px solid #1a1a24;"/></td></tr>`;
    headsUpHtml += `<tr><td style="padding:16px 0 4px 0;font-family:'Space Grotesk',Arial,sans-serif;font-size:18px;font-weight:bold;color:#F5A623;">HEADS UP</td></tr>`;
    headsUpHtml += `<tr><td style="padding:0 0 12px 0;font-family:Inter,Arial,sans-serif;font-size:13px;color:#6B6B76;">Worth booking before they're gone.</td></tr>`;

    const headsUpGrouped = groupEventsByDate(headsUpEvents);
    for (const [dateKey, dateEvents] of headsUpGrouped) {
      headsUpHtml += `<tr><td style="padding:12px 0 6px 0;font-family:'Space Grotesk',Arial,sans-serif;font-size:13px;font-weight:bold;color:#F5A623;letter-spacing:1px;">${formatDateHeader(dateKey)}</td></tr>`;
      for (const event of dateEvents) {
        headsUpHtml += renderEvent(event, true);
      }
    }
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const endDate = new Date(new Date(today).getTime() + 7 * 86400000).toISOString().split("T")[0];
  const dateRange = `${formatDateShort(today)} \u2014 ${formatDateShort(endDate)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0A0A0F;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0A0A0F" style="background-color:#0A0A0F;">
<tr><td align="center" style="padding:0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;margin:0 auto;">
  <tr><td style="padding:32px 24px 8px 24px;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:28px;font-weight:bold;color:#F5A623;">jio</span><br/>
    <span style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#6B6B76;">${dateRange}</span>
  </td></tr>
  <tr><td style="padding:8px 24px 0 24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${eventsHtml}
      ${headsUpHtml}
    </table>
  </td></tr>
  <tr><td style="padding:24px 24px 8px 24px;"><hr style="border:none;border-top:1px solid #1a1a24;"/></td></tr>
  <tr><td style="padding:8px 24px 32px 24px;font-family:Inter,Arial,sans-serif;font-size:13px;">
    <a href="${siteUrl}" style="color:#6B8AFF;text-decoration:none;">See all events \u2192</a><br/>
    <a href="${siteUrl}/unsubscribe?token=${unsubscribeToken}" style="color:#6B6B76;text-decoration:none;font-size:11px;">Unsubscribe</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendDigestEmail(): Promise<{
  sent: number;
  failed: number;
  skipped: string | null;
  errors: string[];
}> {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    return { sent: 0, failed: 0, skipped: "SITE_URL not configured", errors: [] };
  }
  if (!process.env.RESEND_API_KEY) {
    return { sent: 0, failed: 0, skipped: "RESEND_API_KEY not configured", errors: [] };
  }

  initializeDb();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const endDate = new Date(new Date(today).getTime() + 7 * 86400000).toISOString().split("T")[0];

  const events = getPublishedEvents(today, endDate);
  const headsUpEvents = getHeadsUpEvents(today);

  if (events.length === 0 && headsUpEvents.length === 0) {
    return { sent: 0, failed: 0, skipped: "No events for this week", errors: [] };
  }

  const subscribers = getActiveSubscribers();
  if (subscribers.length === 0) {
    return { sent: 0, failed: 0, skipped: "No active subscribers", errors: [] };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || "jio <onboarding@resend.dev>";
  const subject = `jio \u2014 ${formatDateShort(today)} to ${formatDateShort(endDate)}`;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const subscriber of subscribers) {
    const html = buildDigestHtml(events, headsUpEvents, siteUrl, subscriber.unsubscribe_token);
    try {
      await resend.emails.send({
        from,
        to: subscriber.email,
        subject,
        html,
        headers: {
          "List-Unsubscribe": `<${siteUrl}/unsubscribe?token=${subscriber.unsubscribe_token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      sent++;
    } catch (error) {
      failed++;
      errors.push(`${subscriber.email}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return { sent, failed, skipped: null, errors };
}
