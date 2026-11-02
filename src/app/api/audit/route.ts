import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
export const dynamic = "force-dynamic";
function dateValue(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function")
    return value.toDate().toISOString();
  return String(value);
}
export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "audit.read"))
    return NextResponse.json(
      { error: "Audit history is restricted to authorized administrators." },
      { status: 403 },
    );
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim().toLowerCase();
  const action = (params.get("action") ?? "").trim().toLowerCase();
  const recordType = (params.get("recordType") ?? "").trim().toLowerCase();
  const limit = Math.min(500, Math.max(10, Number(params.get("limit") ?? 200)));
  try {
    const root = getAdminServices().db.collection("schools").doc(context.schoolId);
    const snapshot = await root.collection("auditLogs").limit(500).get();
    const entries: Array<
      Record<string, unknown> & { id: string; occurredAt: string | null; requestMetadata: unknown }
    > = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          occurredAt: dateValue(data.occurredAt),
          requestMetadata: data.requestMetadata ?? null,
        };
      })
      .sort((a, b) => String(b.occurredAt ?? "").localeCompare(String(a.occurredAt ?? "")))
      .filter((entry) => {
        const haystack = JSON.stringify(entry).toLowerCase();
        return (
          (!q || haystack.includes(q)) &&
          (!action ||
            String((entry as Record<string, unknown>).action ?? "")
              .toLowerCase()
              .includes(action)) &&
          (!recordType ||
            String((entry as Record<string, unknown>).recordType ?? "").toLowerCase() ===
              recordType)
        );
      })
      .slice(0, limit);
    const actionOptions = Array.from(
      new Set(snapshot.docs.map((doc) => String(doc.get("action") ?? "")).filter(Boolean)),
    ).sort();
    const recordTypes = Array.from(
      new Set(snapshot.docs.map((doc) => String(doc.get("recordType") ?? "")).filter(Boolean)),
    ).sort();
    return NextResponse.json(
      { entries, total: entries.length, actionOptions, recordTypes },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Audit history could not be loaded." }, { status: 500 });
  }
}
