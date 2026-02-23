import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "../../../../lib/admin-auth";
import { initializeDb, getAllSubscribers } from "../../../../lib/db";

export async function GET(request: NextRequest) {
  if (!isAdminAuthenticated(request)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  await initializeDb();
  const subscribers = await getAllSubscribers();

  const mapped = subscribers.map((s) => ({
    id: s.id,
    email: s.email,
    subscribedAt: s.subscribed_at,
    isActive: s.is_active === 1,
  }));

  return NextResponse.json({ subscribers: mapped });
}
