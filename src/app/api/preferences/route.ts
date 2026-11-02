import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext, getSessionUid } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";
import { languages } from "@/lib/i18n/messages";
export const dynamic = "force-dynamic";
const schema = z.object({ language: z.enum(languages) });
export async function GET() {
  const uid = await getSessionUid();
  if (!uid) return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
  const doc = await getAdminServices().db.collection("users").doc(uid).get();
  return NextResponse.json(
    { language: doc.get("preferences.language") ?? "en" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function PATCH(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const uid = await getSessionUid();
  if (!uid) return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  const { db } = getAdminServices();
  await db
    .collection("users")
    .doc(uid)
    .set(
      { preferences: { language: parsed.data.language }, updatedAt: new Date() },
      { merge: true },
    );
  const context = await getSchoolContext();
  if (context)
    await db
      .collection("schools")
      .doc(context.schoolId)
      .collection("auditLogs")
      .add({
        schoolId: context.schoolId,
        actorUid: uid,
        action: "user.language.preference.updated",
        changeSummary: `Language changed to ${parsed.data.language}`,
        occurredAt: new Date(),
      });
  return NextResponse.json({ ok: true, language: parsed.data.language });
}
