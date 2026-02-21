import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, getAdminToken, isAdminAuthenticated } from "../../../../lib/admin-auth";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    if (!password || !verifyPassword(password)) {
      return NextResponse.json(
        { authenticated: false, message: "Invalid password" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ authenticated: true });
    response.cookies.set("admin_token", getAdminToken(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json(
      { authenticated: false, message: "Invalid request" },
      { status: 400 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    authenticated: isAdminAuthenticated(request),
  });
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set("admin_token", "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
