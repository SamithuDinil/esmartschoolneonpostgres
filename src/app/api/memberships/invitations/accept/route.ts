import { NextRequest, NextResponse } from "next/server";
import { getSessionUid } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";
import { invitationAcceptSchema } from "@/server/schemas/membership";
import { acceptInvitation } from "@/server/services/memberships";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rate = await consumeRateLimit(
    `invitation-accept:${requestIp(request)}`,
    10,
    60 * 60 * 1000,
  );
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const uid = await getSessionUid();
  if (!uid)
    return NextResponse.json(
      { error: "Sign in and verify your email before accepting this invitation." },
      { status: 401 },
    );
  const parsed = invitationAcceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "This invitation link is invalid." }, { status: 400 });
  try {
    const result = await acceptInvitation(uid, parsed.data.token);
    return NextResponse.json({ ok: true, ...result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message === "INVITATION_NOT_FOUND")
      return NextResponse.json(
        { error: "This invitation is invalid or has already been used." },
        { status: 404 },
      );
    if (message === "INVITATION_EXPIRED")
      return NextResponse.json(
        { error: "This invitation has expired. Ask the school administrator to issue a new one." },
        { status: 410 },
      );
    if (message === "INVITATION_EMAIL_UNVERIFIED")
      return NextResponse.json(
        { error: "Verify the invited email address before accepting this invitation." },
        { status: 403 },
      );
    if (message === "SCHOOL_UNAVAILABLE")
      return NextResponse.json(
        { error: "This school is not accepting invitations." },
        { status: 410 },
      );
    if (message === "INVITATION_RECIPIENT_MISMATCH")
      return NextResponse.json(
        { error: "This invitation was issued to a different verified email address." },
        { status: 403 },
      );
    if (message === "ALREADY_MEMBER")
      return NextResponse.json(
        { error: "This account is already an active member of the school." },
        { status: 409 },
      );
    return NextResponse.json({ error: "The invitation could not be accepted." }, { status: 500 });
  }
}
