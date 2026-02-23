import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/admin-auth";
import { initializeDb, getRecentScraperRuns } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await initializeDb();
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
