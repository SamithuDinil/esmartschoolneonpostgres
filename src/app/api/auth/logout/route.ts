import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, clearSchoolContextCache } from "@/server/context";
import { cookieOptions } from "@/server/cookies";
import { CSRF_COOKIE, hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json(
      { error: "This secure request expired. Please retry." },
      { status: 403 },
    );
  clearSchoolContextCache();
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  response.cookies.set(CSRF_COOKIE, "", cookieOptions(0));
  return response;
}
