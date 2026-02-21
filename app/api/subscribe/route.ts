import { NextRequest, NextResponse } from "next/server";
import { v4 } from "uuid";
import { initializeDb, insertSubscriber } from "../../../lib/db";

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

  initializeDb();
  const { alreadyExists } = insertSubscriber(v4(), trimmed, v4());

  // Always return success to avoid leaking which emails are subscribed
  return NextResponse.json({ success: true, alreadyExists });
}
