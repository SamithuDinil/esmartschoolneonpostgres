import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE, clearSchoolContextCache } from "@/server/context";
import { cookieOptions } from "@/server/cookies";
import { CSRF_COOKIE, hasValidCsrf } from "@/server/csrf";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const { auth } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, true);
    await auth.revokeRefreshTokens(decoded.uid);
    clearSchoolContextCache();
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
    response.cookies.set(CSRF_COOKIE, "", cookieOptions(0));
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to revoke sessions" }, { status: 401 });
  }
}
