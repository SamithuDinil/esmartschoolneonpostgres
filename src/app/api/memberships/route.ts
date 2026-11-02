import { NextRequest, NextResponse } from "next/server";
import { getSchoolContext } from "@/server/context";
import { hasPermission, permissionsForRole } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { invitationCreateSchema, membershipUpdateSchema } from "@/server/schemas/membership";
import {
  createInvitation,
  listInvitations,
  listMemberships,
  updateMembership,
} from "@/server/services/memberships";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorize() {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "memberships.read")) return null;
  return context;
}

export async function GET(request: NextRequest) {
  const context = await authorize();
  if (!context)
    return NextResponse.json(
      { error: "Membership administration is not available to this role." },
      { status: 403 },
    );
  try {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(
      {
        members: await listMemberships(context, {
          query: params.get("q") ?? "",
          role: params.get("role") ?? "",
          status: params.get("status") ?? "",
        }),
        invitations: await listInvitations(context),
        permissionCatalog: { vice_principal: [...permissionsForRole("vice_principal")] },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Memberships could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const rate = await consumeRateLimit(
    `invitation-create:${requestIp(request)}`,
    30,
    60 * 60 * 1000,
  );
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await authorize();
  if (!context || !hasPermission(context.permissions, "memberships.manage"))
    return NextResponse.json(
      { error: "Membership management permission required." },
      { status: 403 },
    );
  const parsed = invitationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Check the member details and try again.",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  try {
    const invitation = await createInvitation(context, parsed.data);
    return NextResponse.json(
      {
        ok: true,
        invitationUrl: `${new URL(request.url).origin}/invite?token=${encodeURIComponent(invitation.token)}`,
        expiresAt: invitation.expiresAt,
        delivery: "queued",
      },
      { status: 201 },
    );
  } catch (cause) {
    const duplicate = cause instanceof Error && cause.message.includes("ALREADY");
    return NextResponse.json(
      {
        error: duplicate
          ? "A matching invitation already exists."
          : "Member invitation could not be saved.",
      },
      { status: duplicate ? 409 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await authorize();
  if (!context || !hasPermission(context.permissions, "memberships.manage"))
    return NextResponse.json(
      { error: "Membership management permission required." },
      { status: 403 },
    );
  const parsed = membershipUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid membership update." }, { status: 400 });
  try {
    await updateMembership(context, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "MEMBERSHIP_NOT_FOUND")
      return NextResponse.json({ error: "Membership not found." }, { status: 404 });
    if (cause instanceof Error && cause.message === "CANNOT_DISABLE_SELF")
      return NextResponse.json(
        { error: "You cannot suspend or revoke your own active membership." },
        { status: 409 },
      );
    if (cause instanceof Error && cause.message === "CANNOT_DISABLE_OWNER")
      return NextResponse.json(
        { error: "Transfer ownership before suspending or removing the current owner." },
        { status: 409 },
      );
    if (cause instanceof Error && cause.message === "OWNER_REQUIRED")
      return NextResponse.json(
        { error: "Only the school owner can customize permissions." },
        { status: 403 },
      );
    if (cause instanceof Error && cause.message === "PERMISSION_ESCALATION")
      return NextResponse.json(
        { error: "Custom permissions must be a subset of the selected role." },
        { status: 400 },
      );
    return NextResponse.json({ error: "Membership update could not be saved." }, { status: 500 });
  }
}
