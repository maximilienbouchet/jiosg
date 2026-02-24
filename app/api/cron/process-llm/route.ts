import { NextRequest, NextResponse } from "next/server";
import { processUnfilteredEvents } from "../../../../lib/llm";
import { verifyCronAuth } from "../../../../lib/cron-auth";

export const maxDuration = 120;

async function handleProcessLlm() {
  try {
    const result = await processUnfilteredEvents(10);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return handleProcessLlm();
}

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return handleProcessLlm();
}
