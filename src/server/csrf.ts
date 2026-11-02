import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const CSRF_COOKIE = "edusphere_csrf";

export function hasValidCsrf(request: NextRequest): boolean {
  const cookie = Buffer.from(request.cookies.get(CSRF_COOKIE)?.value ?? "");
  const header = Buffer.from(request.headers.get("x-csrf-token") ?? "");
  return cookie.length > 0 && cookie.length === header.length && timingSafeEqual(cookie, header);
}
