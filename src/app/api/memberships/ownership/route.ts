import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { ownershipTransferSchema } from "@/server/schemas/membership";
import { transferOwnership } from "@/server/services/memberships";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (
    !context ||
    !hasPermission(context.permissions, "school.ownership.transfer") ||
    context.role !== "school_owner"
  )
    return NextResponse.json(
      { error: "Only the current school owner can transfer ownership." },
      { status: 403 },
    );
  const parsed = ownershipTransferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Ownership transfer requires a target member, confirmation phrase, and fresh reauthentication.",
      },
      { status: 400 },
    );
  try {
    const { auth } = getAdminServices();
    const reauthenticated = await auth.verifyIdToken(parsed.data.reauthenticatedIdToken, true);
    if (
      reauthenticated.uid !== context.uid ||
      !reauthenticated.email_verified ||
      !reauthenticated.auth_time ||
      Date.now() / 1000 - reauthenticated.auth_time > 5 * 60
    )
      return NextResponse.json(
        { error: "Reauthenticate within the last five minutes before transferring ownership." },
        { status: 401 },
      );
    await transferOwnership(context, parsed.data.targetUid);
    return NextResponse.json({ ok: true, ownerUid: parsed.data.targetUid });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "TARGET_NOT_ELIGIBLE")
      return NextResponse.json(
        {
          error:
            "Select an active principal, vice principal, or school administrator as the new owner.",
        },
        { status: 409 },
      );
    if (cause instanceof Error && cause.message === "OWNER_REQUIRED")
      return NextResponse.json(
        { error: "The current account is no longer the recorded school owner." },
        { status: 403 },
      );
    return NextResponse.json(
      { error: "Ownership transfer could not be completed." },
      { status: 500 },
    );
  }
}
