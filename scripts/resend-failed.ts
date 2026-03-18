import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { Resend } from "resend";
import {
  initializeDb,
  getClient,
  getPublishedEvents,
  getTopHeadsUpEventsForDigest,
  getPreviousDigestEventIds,
  logEmailSend,
} from "../lib/db";
import { buildDigestHtml } from "../lib/email";
import { getDigestWindow } from "../lib/dates";
import { classifyDigestEvents } from "../lib/digest-classify";

async function main() {
  await initializeDb();
  const db = getClient();

  // Find the most recent digest run
  const runsResult = await db.execute(
    "SELECT * FROM digest_runs ORDER BY ran_at DESC LIMIT 1"
  );
  const latestRun = runsResult.rows[0] as unknown as {
    id: string;
    ran_at: string;
    subject: string | null;
  };

  if (!latestRun) {
    console.log("No digest runs found.");
    return;
  }

  console.log(`Latest digest run: ${latestRun.id} at ${latestRun.ran_at}`);
  console.log(`Subject: ${latestRun.subject}`);

  // Find failed email logs for that run (only rate-limit errors, skip invalid emails)
  const failedResult = await db.execute({
    sql: `SELECT el.*, s.unsubscribe_token
          FROM email_logs el
          JOIN subscribers s ON s.id = el.subscriber_id
          WHERE el.digest_run_id = ?
            AND el.status = 'failed'
            AND el.error LIKE '%Too many requests%'`,
    args: [latestRun.id],
  });

  const failed = failedResult.rows as unknown as {
    id: string;
    subscriber_id: string;
    email: string;
    error: string;
    unsubscribe_token: string;
  }[];

  if (failed.length === 0) {
    console.log("No rate-limited failures to retry.");
    return;
  }

  console.log(`\nFound ${failed.length} rate-limited failures to retry:`);
  for (const f of failed) {
    console.log(`  - ${f.email}: ${f.error}`);
  }

  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    console.error("SITE_URL not set");
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set");
    return;
  }

  // Rebuild the same email content using the same date window
  // The digest was sent on the ran_at date, so use that date for the window
  const ranDate = latestRun.ran_at.includes("T")
    ? latestRun.ran_at.split("T")[0]
    : latestRun.ran_at.split(" ")[0];
  const { start: startDate, end: endDate } = getDigestWindow(ranDate);

  const events = await getPublishedEvents(startDate, endDate);
  const headsUpEvents = await getTopHeadsUpEventsForDigest(ranDate, 3);

  console.log(`\nEvents for window ${startDate} to ${endDate}: ${events.length}`);
  console.log(`Heads-up events: ${headsUpEvents.length}`);

  // Re-classify at retry time
  const previousEventIds = await getPreviousDigestEventIds();
  const classified = classifyDigestEvents(events, new Set(previousEventIds.keys()), endDate);

  const subject = latestRun.subject || "jio — your weekend sorted";
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || "jio <onboarding@resend.dev>";

  let sent = 0;
  let failedCount = 0;

  for (let i = 0; i < failed.length; i++) {
    const subscriber = failed[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 600));

    const html = buildDigestHtml(classified, headsUpEvents, siteUrl, subscriber.unsubscribe_token, {
      weekStart: startDate,
      startDate,
      endDate,
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
        failedCount++;
        console.log(`  FAILED ${subscriber.email}: ${resendError.message}`);
      } else {
        sent++;
        console.log(`  SENT ${subscriber.email} (${data?.id})`);
        await logEmailSend({
          digest_run_id: latestRun.id,
          subscriber_id: subscriber.subscriber_id,
          email: subscriber.email,
          subject,
          resend_message_id: data?.id ?? null,
          status: "sent",
          error: null,
        });
      }
    } catch (err) {
      failedCount++;
      console.log(`  ERROR ${subscriber.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone: ${sent} sent, ${failedCount} failed`);
}

main().catch(console.error);
