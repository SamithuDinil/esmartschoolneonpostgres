import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";
import { schoolCreateSchema } from "@/server/schemas/school";
import { createSchoolBySystemOwner } from "@/server/services/platform-school-creation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const registrationSchema = schoolCreateSchema.extend({
  principalName: z.string().trim().min(2).max(120),
  principalEmail: z.email().max(254),
});

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Please check the school and principal details.",
        fields: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json(
      { error: "Sign in as a System Owner before registering a school." },
      { status: 401 },
    );
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, true);
    if (decoded.email_verified !== true)
      return NextResponse.json(
        { error: "Verify your owner account email before registering a school." },
        { status: 403 },
      );
    const owner = await db.collection("platformOwners").doc(decoded.uid).get();
    if (!owner.exists || owner.get("status") !== "active")
      return NextResponse.json(
        { error: "Only a provisioned System Owner can register schools." },
        { status: 403 },
      );
    const result = await createSchoolBySystemOwner(
      decoded.uid,
      parsed.data,
      { name: parsed.data.principalName, email: parsed.data.principalEmail },
      new URL(request.url).origin,
    );
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "SCHOOL_CODE_TAKEN")
      return NextResponse.json(
        { error: "That school code is already registered. Choose a unique code." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "School registration could not be completed." },
      { status: 500 },
    );
  }
}
