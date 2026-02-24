import { Resend } from "resend";
import { initializeDb, getPublishedEvents, getHeadsUpEvents } from "../lib/db";
import { buildDigestHtml } from "../lib/email";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: npx tsx scripts/send-test-digest.ts your@email.com");
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set");
    process.exit(1);
  }

  const siteUrl = process.env.SITE_URL || "https://jio.sg";
  const from = process.env.FROM_EMAIL || "jio <onboarding@resend.dev>";

  await initializeDb();

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const endDate = new Date(new Date(today).getTime() + 7 * 86400000).toISOString().split("T")[0];

  const events = await getPublishedEvents(today, endDate);
  const headsUpEvents = await getHeadsUpEvents(today);

  if (events.length === 0 && headsUpEvents.length === 0) {
    console.log("No published events found for the next 7 days. Email would be empty.");
    process.exit(0);
  }

  console.log(`Found ${events.length} events + ${headsUpEvents.length} heads-up events`);

  const html = buildDigestHtml(events, headsUpEvents, siteUrl, "test-token");

  const resend = new Resend(process.env.RESEND_API_KEY);
  const subject = `[TEST] jio digest — ${today}`;

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
  });

  if (error) {
    console.error("Failed to send:", error);
    process.exit(1);
  }

  console.log(`Test digest sent to ${to} (id: ${data?.id})`);
}

main();
