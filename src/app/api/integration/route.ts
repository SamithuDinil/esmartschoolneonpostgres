import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { buildIntegrationHealth } from "@/server/services/integration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const eventSchema = z.object({
  action: z.literal("record_event"),
  eventType: z.string().trim().min(3).max(80),
  recordId: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(3).max(500),
  sourceModule: z.string().trim().min(2).max(80),
});

export async function GET() {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "integration.read"))
    return NextResponse.json(
      { error: "Integration health access is restricted." },
      { status: 403 },
    );
  try {
    return NextResponse.json(await buildIntegrationHealth(context), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Integration health could not be calculated." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "settings.manage"))
    return NextResponse.json(
      { error: "Integration event writes are restricted to school administrators." },
      { status: 403 },
    );
  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid integration event." }, { status: 400 });
  try {
    const root = getAdminServices().db.collection("schools").doc(context.schoolId);
    const ref = root
      .collection("integrationEvents")
      .doc(`${parsed.data.eventType}-${parsed.data.recordId}`);
    await ref.set(
      {
        schoolId: context.schoolId,
        ...parsed.data,
        recordedBy: context.uid,
        recordedAt: new Date(),
      },
      { merge: true },
    );
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "integration.event.recorded",
      recordType: "integrationEvent",
      recordId: ref.id,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Integration event could not be recorded." },
      { status: 500 },
    );
  }
}
