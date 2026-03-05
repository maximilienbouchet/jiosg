import { NextRequest, NextResponse } from "next/server";
import { v4 } from "uuid";
import { resolveMx, resolve4 } from "dns/promises";
import { initializeDb, insertSubscriber } from "../../../lib/db";
import { sendWelcomeEmail } from "../../../lib/email";

export async function POST(request: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request" }, { status: 400 });
  }

  const { email } = body;
  if (!email || typeof email !== "string") {
    return NextResponse.json({ success: false, message: "Email is required" }, { status: 400 });
  }

  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 254) {
    return NextResponse.json({ success: false, message: "Invalid email" }, { status: 400 });
  }

  // Verify the email domain has MX (or at least A) records
  const domain = trimmed.split("@")[1];
  try {
    await resolveMx(domain);
  } catch {
    try {
      await resolve4(domain);
    } catch {
      return NextResponse.json({ success: false, message: "Invalid email domain" }, { status: 400 });
    }
  }

  await initializeDb();
  const subscriberId = v4();
  const unsubscribeToken = v4();
  const { alreadyExists } = await insertSubscriber(subscriberId, trimmed, unsubscribeToken);

  if (!alreadyExists) {
    try {
      await sendWelcomeEmail(trimmed, unsubscribeToken);
    } catch (err) {
      console.error("[welcome-email] Failed:", err);
    }
  }

  // Always return success to avoid leaking which emails are subscribed
  return NextResponse.json({ success: true, alreadyExists });
}
