import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request)) return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string };
  const active = body.action !== "offline";
  await getAdminServices().db.collection("users").doc(context.uid).set(
    { isOnline: active, onlineAt: FieldValue.serverTimestamp() }, { merge: true },
  );
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
