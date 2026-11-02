import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookieOptions } from "@/server/cookies";
import { CSRF_COOKIE } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const csrfToken = randomBytes(32).toString("base64url");
  const response = NextResponse.json({ csrfToken }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(CSRF_COOKIE, csrfToken, cookieOptions(10 * 60));
  return response;
}
