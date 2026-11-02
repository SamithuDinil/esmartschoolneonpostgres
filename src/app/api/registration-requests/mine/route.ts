import { NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSessionUid } from "@/server/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const uid = await getSessionUid();
  if (!uid)
    return NextResponse.json(
      { error: "Sign in to view your registration status." },
      { status: 401 },
    );
  try {
    const { auth, db } = getAdminServices();
    const account = await auth.getUser(uid);
    if (!account.emailVerified)
      return NextResponse.json(
        { error: "Verify your email address to view registration status." },
        { status: 403 },
      );
    const snap = await db
      .collectionGroup("registrationRequests")
      .where("uid", "==", uid)
      .limit(20)
      .get();
    const requests = await Promise.all(
      snap.docs.map(async (doc) => {
        const schoolRef = doc.ref.parent.parent;
        const school = schoolRef ? await schoolRef.get() : null;
        const request = doc.data();
        const date = request.requestedAt?.toDate?.();
        const decidedAt = request.decidedAt?.toDate?.();
        return {
          id: doc.id,
          schoolName: school?.get("name") ?? "School",
          role: request.role ?? "member",
          status: request.status ?? "pending",
          requestedAt: date instanceof Date ? date.toISOString() : null,
          decidedAt: decidedAt instanceof Date ? decidedAt.toISOString() : null,
        };
      }),
    );
    return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Registration status could not be loaded." },
      { status: 500 },
    );
  }
}
