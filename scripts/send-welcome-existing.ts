import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { initializeDb, getActiveSubscribers } from "../lib/db";
import { sendWelcomeEmail } from "../lib/email";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await initializeDb();
  const subscribers = await getActiveSubscribers();

  console.log(`Found ${subscribers.length} active subscriber(s)`);
  if (dryRun) {
    console.log("[DRY RUN] Would send welcome email to:");
    for (const sub of subscribers) {
      console.log(`  - ${sub.email}`);
    }
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    const result = await sendWelcomeEmail(sub.email, sub.unsubscribe_token);
    if (result.sent) {
      sent++;
      console.log(`  Sent: ${sub.email}`);
    } else {
      failed++;
      console.error(`  Failed: ${sub.email} — ${result.error}`);
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
