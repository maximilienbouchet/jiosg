import { Resend } from "resend";
import {
  initializeDb,
  getPublishedEvents,
  getTopHeadsUpEventsForDigest,
  getActiveSubscribers,
  EventRow,
  createDigestRun,
  updateDigestRun,
  logEmailSend,
} from "./db";
import { formatDateRange, getDigestWindow } from "./dates";
import { generateDigestIntro } from "./llm";

export interface LlmPipelineStats {
  processed: number;
  included: number;
  excluded: number;
  errors: number;
  deduplicated: number;
  batches: number;
  crashed?: boolean;
  crashError?: string;
}

export async function sendPipelineReportEmail(
  scraper: {
    zeroSources: string[];
    errorSources: Record<string, string>;
    bySource: Record<string, number>;
  },
  llm?: LlmPipelineStats
): Promise<{ sent: boolean; error: string | null }> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn("[pipeline-report] ADMIN_EMAIL not configured, skipping");
    return { sent: false, error: "ADMIN_EMAIL not configured" };
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn("[pipeline-report] RESEND_API_KEY not configured, skipping");
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Singapore" }).toUpperCase();

  const hasScraperIssues = scraper.zeroSources.length > 0 || Object.keys(scraper.errorSources).length > 0;
  const hasLlmIssues = llm ? (llm.errors > 0 || llm.crashed === true) : false;
  const hasIssues = hasScraperIssues || hasLlmIssues;

  let subject: string;
  if (!llm) {
    subject = "\uD83D\uDEA8 jio scraper alert";
  } else if (hasIssues) {
    subject = "\uD83D\uDEA8 jio pipeline alert";
  } else {
    subject = "\u2705 jio pipeline report";
  }

  let body = `jio pipeline report — ${dateStr}, ${timeStr} SGT\n\n`;

  // Summary line (only when LLM stats available)
  if (llm) {
    const totalScraped = Object.values(scraper.bySource).reduce((a, b) => a + b, 0);
    body += `SUMMARY: ${totalScraped} scraped · ${llm.included} curated · ${llm.excluded} excluded · ${llm.deduplicated} deduped · ${llm.errors} errors\n\n`;
  }

  // Issues section
  if (hasIssues) {
    body += `\u26A0\uFE0F  ISSUES DETECTED\n`;
    if (scraper.zeroSources.length > 0) {
      body += `Scrapers with 0 events:\n`;
      for (const src of scraper.zeroSources) {
        body += `  - ${src}\n`;
      }
    }
    if (Object.keys(scraper.errorSources).length > 0) {
      body += `Scraper errors:\n`;
      for (const [src, msg] of Object.entries(scraper.errorSources)) {
        body += `  - ${src}: ${msg}\n`;
      }
    }
    if (llm && llm.errors > 0) {
      body += `LLM errors: ${llm.errors} events failed\n`;
    }
    if (llm?.crashed) {
      body += `LLM crashed: ${llm.crashError || "Unknown error"}\n`;
    }
    body += `\n`;
  }

  // Scrapers section
  body += `--- SCRAPERS ---\n`;
  for (const [src, count] of Object.entries(scraper.bySource)) {
    body += `  ${src}: ${count} events\n`;
  }
  for (const src of Object.keys(scraper.errorSources)) {
    if (!(src in scraper.bySource)) {
      body += `  ${src}: FAILED\n`;
    }
  }

  // LLM section (only when stats available)
  if (llm) {
    body += `\n--- LLM PIPELINE ---\n`;
    body += `  Processed:    ${llm.processed}\n`;
    body += `  Included:     ${llm.included}\n`;
    body += `  Excluded:     ${llm.excluded}\n`;
    body += `  Deduplicated: ${llm.deduplicated}\n`;
    body += `  Errors:       ${llm.errors}\n`;
    body += `  Batches:      ${llm.batches}\n`;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || "jio <onboarding@resend.dev>";

  try {
    await resend.emails.send({
      from,
      to: adminEmail,
      subject,
      text: body,
    });
    return { sent: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipeline-report] Failed to send:", message);
    return { sent: false, error: message };
  }
}

const EMAIL_TAG_COLORS: Record<string, string> = {
  "live & loud": "#3B82F6",
  "culture fix": "#9F67FF",
  "go see": "#D97706",
  "game on": "#22C55E",
  "screen time": "#EF4444",
  "taste test": "#F2568B",
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

function groupEventsByDate(events: EventRow[], weekStart?: string): Map<string, EventRow[]> {
  const groups = new Map<string, EventRow[]>();
  for (const event of events) {
    const eventStart = event.event_date_start.split("T")[0];
    // Multi-day events that started before the week get grouped under the week's first day
    const dateKey = weekStart && eventStart < weekStart ? weekStart : eventStart;
    const existing = groups.get(dateKey) || [];
    existing.push(event);
    groups.set(dateKey, existing);
  }
  return groups;
}

function renderTagPill(tag: string): string {
  const color = EMAIL_TAG_COLORS[tag] || "#9494A0";
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
  const dateRange = formatDateRange(event.event_date_start, event.event_date_end);
  const dateRangeHtml = dateRange
    ? `<span style="color:#9494A0;font-size:13px;font-family:Inter,Arial,sans-serif;">${dateRange}</span><br/>`
    : "";

  return `<tr><td style="padding:0 0 20px 0;${leftBorder}">
    ${titleHtml}<br/>
    <span style="color:#9494A0;font-size:13px;font-family:Inter,Arial,sans-serif;">${venue}</span><br/>
    ${dateRangeHtml}<span style="color:#E8E8ED;font-size:14px;font-family:Inter,Arial,sans-serif;">${blurb}</span><br/>
    <div style="margin-top:6px;">${tagHtml}</div>
  </td></tr>`;
}

export function buildDigestHtml(
  events: EventRow[],
  headsUpEvents: EventRow[],
  siteUrl: string,
  unsubscribeToken: string,
  options?: {
    weekStart?: string;
    startDate?: string;
    endDate?: string;
    introHtml?: string;
  }
): string {
  const grouped = groupEventsByDate(events, options?.weekStart);

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
    headsUpHtml += `<tr><td style="padding:0 0 12px 0;font-family:Inter,Arial,sans-serif;font-size:13px;color:#9494A0;">Worth booking before they're gone.</td></tr>`;

    const headsUpGrouped = groupEventsByDate(headsUpEvents);
    for (const [dateKey, dateEvents] of headsUpGrouped) {
      headsUpHtml += `<tr><td style="padding:12px 0 6px 0;font-family:'Space Grotesk',Arial,sans-serif;font-size:13px;font-weight:bold;color:#F5A623;letter-spacing:1px;">${formatDateHeader(dateKey)}</td></tr>`;
      for (const event of dateEvents) {
        headsUpHtml += renderEvent(event, true);
      }
    }
  }

  const startDate = options?.startDate || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const endDate = options?.endDate || new Date(new Date(startDate).getTime() + 7 * 86400000).toISOString().split("T")[0];
  const dateRange = `${formatDateShort(startDate)} \u2014 ${formatDateShort(endDate)}`;

  const introBlock = options?.introHtml
    ? `<tr><td style="padding:8px 24px 12px 24px;font-family:Inter,Arial,sans-serif;font-size:14px;color:#E8E8ED;line-height:1.5;">${options.introHtml}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0A0A0F;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0A0A0F" style="background-color:#0A0A0F;">
<tr><td align="center" style="padding:0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;margin:0 auto;">
  <tr><td style="padding:32px 24px 8px 24px;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:28px;font-weight:bold;color:#F5A623;">jio</span><br/>
    <span style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#9494A0;">${dateRange}</span>
  </td></tr>
  ${introBlock}
  <tr><td style="padding:8px 24px 0 24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${eventsHtml}
      ${headsUpHtml}
    </table>
  </td></tr>
  <tr><td style="padding:24px 24px 8px 24px;"><hr style="border:none;border-top:1px solid #1a1a24;"/></td></tr>
  <tr><td style="padding:8px 24px 32px 24px;font-family:Inter,Arial,sans-serif;font-size:13px;">
    <a href="${siteUrl}" style="color:#6B8AFF;text-decoration:none;">See all events \u2192</a><br/>
    <a href="${siteUrl}/unsubscribe?token=${unsubscribeToken}" style="color:#9494A0;text-decoration:none;font-size:11px;">Unsubscribe</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildWelcomeHtml(
  events: EventRow[],
  siteUrl: string,
  unsubscribeToken: string
): string {
  let eventsHtml = "";
  if (events.length > 0) {
    eventsHtml += `<tr><td style="padding:16px 0 8px 0;font-family:'Space Grotesk',Arial,sans-serif;font-size:14px;font-weight:bold;color:#E8E8ED;">On our radar — worth booking early:</td></tr>`;

    const grouped = groupEventsByDate(events);
    for (const [dateKey, dateEvents] of grouped) {
      eventsHtml += `<tr><td style="padding:12px 0 6px 0;font-family:'Space Grotesk',Arial,sans-serif;font-size:13px;font-weight:bold;color:#F5A623;letter-spacing:1px;">${formatDateHeader(dateKey)}</td></tr>`;
      for (const event of dateEvents) {
        eventsHtml += renderEvent(event, true);
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#0A0A0F;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0A0A0F" style="background-color:#0A0A0F;">
<tr><td align="center" style="padding:0;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;margin:0 auto;">
  <tr><td style="padding:32px 24px 8px 24px;">
    <span style="font-family:'Space Grotesk',Arial,sans-serif;font-size:28px;font-weight:bold;color:#F5A623;">jio</span>
  </td></tr>
  <tr><td style="padding:16px 24px 0 24px;font-family:Inter,Arial,sans-serif;font-size:15px;color:#E8E8ED;line-height:1.6;">
    Hey — you're on the list.<br/><br/>
    Every Thursday at 6pm, you'll get a short email with the best things happening in Singapore that week. No noise, no sponsored posts, no "networking mixers." Just stuff worth leaving the house for.
  </td></tr>
  <tr><td style="padding:8px 24px 0 24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${eventsHtml}
    </table>
  </td></tr>
  <tr><td style="padding:20px 24px 0 24px;font-family:Inter,Arial,sans-serif;font-size:15px;color:#E8E8ED;">
    See you Thursday.
  </td></tr>
  <tr><td style="padding:24px 24px 8px 24px;"><hr style="border:none;border-top:1px solid #1a1a24;"/></td></tr>
  <tr><td style="padding:8px 24px 32px 24px;font-family:Inter,Arial,sans-serif;font-size:13px;">
    <a href="${siteUrl}" style="color:#6B8AFF;text-decoration:none;">See all events \u2192</a><br/>
    <a href="${siteUrl}/unsubscribe?token=${unsubscribeToken}" style="color:#9494A0;text-decoration:none;font-size:11px;">Unsubscribe</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export async function sendWelcomeEmail(
  email: string,
  unsubscribeToken: string
): Promise<{ sent: boolean; error: string | null }> {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    console.warn("[welcome-email] SITE_URL not configured, skipping");
    return { sent: false, error: "SITE_URL not configured" };
  }
  if (!process.env.RESEND_API_KEY) {
    console.warn("[welcome-email] RESEND_API_KEY not configured, skipping");
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  await initializeDb();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const events = await getTopHeadsUpEventsForDigest(today, 2);

  const html = buildWelcomeHtml(events, siteUrl, unsubscribeToken);
  const subject = "you're in";

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || "jio <onboarding@resend.dev>";

  try {
    await resend.emails.send({
      from,
      to: email,
      subject,
      html,
      headers: {
        "List-Unsubscribe": `<${siteUrl}/unsubscribe?token=${unsubscribeToken}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    return { sent: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[welcome-email] Failed to send:", message);
    return { sent: false, error: message };
  }
}

export async function sendDigestEmail(): Promise<{
  sent: number;
  failed: number;
  skipped: string | null;
  errors: string[];
  digestRunId: string;
}> {
  const digestRunId = crypto.randomUUID();

  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    await initializeDb();
    await createDigestRun({ id: digestRunId, subject: null, events_count: 0, heads_up_count: 0, subscribers_count: 0, skipped: "SITE_URL not configured" });
    await updateDigestRun(digestRunId, { total_sent: 0, total_failed: 0 });
    return { sent: 0, failed: 0, skipped: "SITE_URL not configured", errors: [], digestRunId };
  }
  if (!process.env.RESEND_API_KEY) {
    await initializeDb();
    await createDigestRun({ id: digestRunId, subject: null, events_count: 0, heads_up_count: 0, subscribers_count: 0, skipped: "RESEND_API_KEY not configured" });
    await updateDigestRun(digestRunId, { total_sent: 0, total_failed: 0 });
    return { sent: 0, failed: 0, skipped: "RESEND_API_KEY not configured", errors: [], digestRunId };
  }

  await initializeDb();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const { start: startDate, end: endDate } = getDigestWindow(today);

  const events = await getPublishedEvents(startDate, endDate);
  const headsUpEvents = await getTopHeadsUpEventsForDigest(today, 3);

  if (events.length === 0 && headsUpEvents.length === 0) {
    await createDigestRun({ id: digestRunId, subject: null, events_count: 0, heads_up_count: 0, subscribers_count: 0, skipped: "No events for this week" });
    await updateDigestRun(digestRunId, { total_sent: 0, total_failed: 0 });
    return { sent: 0, failed: 0, skipped: "No events for this week", errors: [], digestRunId };
  }

  const subscribers = await getActiveSubscribers();
  if (subscribers.length === 0) {
    await createDigestRun({ id: digestRunId, subject: null, events_count: events.length, heads_up_count: headsUpEvents.length, subscribers_count: 0, skipped: "No active subscribers" });
    await updateDigestRun(digestRunId, { total_sent: 0, total_failed: 0 });
    return { sent: 0, failed: 0, skipped: "No active subscribers", errors: [], digestRunId };
  }

  // Generate AI intro + subject once before the subscriber loop
  const digestIntro = await generateDigestIntro(events);
  const subject = digestIntro?.subject
    ? `jio — ${digestIntro.subject}`
    : "jio — your weekend sorted";
  const introHtml = digestIntro?.intro || undefined;

  await createDigestRun({
    id: digestRunId,
    subject,
    events_count: events.length,
    heads_up_count: headsUpEvents.length,
    subscribers_count: subscribers.length,
    skipped: null,
  });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || "jio <onboarding@resend.dev>";

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < subscribers.length; i++) {
    const subscriber = subscribers[i];
    // Resend free tier allows 2 requests/second — pause between sends
    if (i > 0) await new Promise((r) => setTimeout(r, 600));

    const html = buildDigestHtml(events, headsUpEvents, siteUrl, subscriber.unsubscribe_token, {
      weekStart: startDate,
      startDate,
      endDate,
      introHtml,
    });
    try {
      const { data, error: resendError } = await resend.emails.send({
        from,
        to: subscriber.email,
        subject,
        html,
        headers: {
          "List-Unsubscribe": `<${siteUrl}/unsubscribe?token=${subscriber.unsubscribe_token}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      if (resendError) {
        failed++;
        const errMsg = resendError.message || "Resend API error";
        errors.push(`${subscriber.email}: ${errMsg}`);
        await logEmailSend({
          digest_run_id: digestRunId,
          subscriber_id: subscriber.id,
          email: subscriber.email,
          subject,
          resend_message_id: null,
          status: "failed",
          error: errMsg,
        });
      } else {
        sent++;
        await logEmailSend({
          digest_run_id: digestRunId,
          subscriber_id: subscriber.id,
          email: subscriber.email,
          subject,
          resend_message_id: data?.id ?? null,
          status: "sent",
          error: null,
        });
      }
    } catch (error) {
      failed++;
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`${subscriber.email}: ${errMsg}`);
      await logEmailSend({
        digest_run_id: digestRunId,
        subscriber_id: subscriber.id,
        email: subscriber.email,
        subject,
        resend_message_id: null,
        status: "failed",
        error: errMsg,
      });
    }
  }

  await updateDigestRun(digestRunId, { total_sent: sent, total_failed: failed });

  return { sent, failed, skipped: null, errors, digestRunId };
}
