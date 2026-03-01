import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/admin-auth";
import { initializeDb, getRecentDigestRuns, getDigestRunDetails } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await initializeDb();

  const runId = request.nextUrl.searchParams.get("runId");

  if (runId) {
    const { run, logs } = await getDigestRunDetails(runId);
    if (!run) {
      return NextResponse.json({ message: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({
      run: {
        id: run.id,
        ranAt: run.ran_at,
        subject: run.subject,
        eventsCount: run.events_count,
        headsUpCount: run.heads_up_count,
        subscribersCount: run.subscribers_count,
        totalSent: run.total_sent,
        totalFailed: run.total_failed,
        skipped: run.skipped,
        completedAt: run.completed_at,
      },
      logs: logs.map((l) => ({
        id: l.id,
        email: l.email,
        status: l.status,
        resendMessageId: l.resend_message_id,
        error: l.error,
        sentAt: l.sent_at,
      })),
    });
  }

  const runs = await getRecentDigestRuns(20);
  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      ranAt: r.ran_at,
      subject: r.subject,
      eventsCount: r.events_count,
      headsUpCount: r.heads_up_count,
      subscribersCount: r.subscribers_count,
      totalSent: r.total_sent,
      totalFailed: r.total_failed,
      skipped: r.skipped,
      completedAt: r.completed_at,
    })),
  });
}
