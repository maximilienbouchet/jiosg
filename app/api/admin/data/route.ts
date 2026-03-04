import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/admin-auth";
import {
  initializeDb,
  getRecentScraperRuns,
  getAllSubscribers,
  getRecentDigestRuns,
  getDigestRunDetails,
} from "../../../../lib/db";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

// GET /api/admin/data?type=scraper-health
// GET /api/admin/data?type=subscribers
// GET /api/admin/data?type=email-logs
// GET /api/admin/data?type=email-logs&runId=xxx
export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) return unauthorized();

  const type = request.nextUrl.searchParams.get("type");
  await initializeDb();

  switch (type) {
    case "scraper-health": {
      const runs = await getRecentScraperRuns(7);
      const mapped = runs.map((r) => ({
        id: r.id,
        source: r.source,
        eventsFound: r.events_found,
        error: r.error,
        ranAt: r.ran_at,
      }));
      return NextResponse.json({ runs: mapped });
    }

    case "subscribers": {
      const subscribers = await getAllSubscribers();
      const mapped = subscribers.map((s) => ({
        id: s.id,
        email: s.email,
        subscribedAt: s.subscribed_at,
        isActive: s.is_active === 1,
      }));
      return NextResponse.json({ subscribers: mapped });
    }

    case "email-logs": {
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

    default:
      return NextResponse.json(
        { message: "Missing or invalid type parameter. Use: scraper-health, subscribers, email-logs" },
        { status: 400 }
      );
  }
}
