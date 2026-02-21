import { createHash } from "crypto";
import { NextRequest } from "next/server";

const SALT = "jio-admin-salt";

export function verifyPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return password === adminPassword;
}

export function getAdminToken(): string {
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  return createHash("sha256").update(adminPassword + SALT).digest("hex");
}

export function isAdminAuthenticated(request: NextRequest): boolean {
  const cookie = request.cookies.get("admin_token");
  if (!cookie) return false;
  return cookie.value === getAdminToken();
}
