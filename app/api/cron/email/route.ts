import { NextRequest, NextResponse } from "next/server";
import { sendDigestEmail } from "../../../../lib/email";
import { verifyCronAuth } from "../../../../lib/cron-auth";

async function handleEmail() {
  try {
    const result = await sendDigestEmail();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return handleEmail();
}

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return handleEmail();
}
