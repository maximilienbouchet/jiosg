import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { initializeDb, getTopHeadsUpEventsForDigest } from "../lib/db";
import { buildWelcomeHtml } from "../lib/email";
import { Resend } from "resend";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: npx tsx scripts/send-test-welcome.ts your@email.com");
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
  const events = await getTopHeadsUpEventsForDigest(today, 2);
  console.log(`Found ${events.length} heads-up events to include`);

  const html = buildWelcomeHtml(events, siteUrl, "test-token");

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: "[TEST] you're in",
    html,
  });

  if (error) {
    console.error("Failed to send:", error);
    process.exit(1);
  }

  console.log(`Test welcome email sent to ${to} (id: ${data?.id})`);
}

main();
