import "server-only";
import type { NextRequest } from "next/server";
import type { SchoolContext } from "@/server/context";
import { getAdminServices } from "@/lib/firebase/admin";

type AuditExtra = {
  recordType?: string;
  recordId?: string;
  changeSummary?: string;
  changedFields?: string[];
  requestMetadata?: Record<string, string | null>;
  [key: string]: unknown;
};
export function requestMetadata(request: NextRequest) {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    referer: request.headers.get("referer")?.slice(0, 500) ?? null,
  };
}
export async function writeAudit(
  context: Pick<SchoolContext, "schoolId" | "uid">,
  action: string,
  extra: AuditExtra = {},
) {
  const {
    recordType,
    recordId,
    changeSummary,
    changedFields,
    requestMetadata: metadata,
    ...rest
  } = extra;
  await getAdminServices()
    .db.collection("schools")
    .doc(context.schoolId)
    .collection("auditLogs")
    .add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action,
      ...(recordType ? { recordType } : {}),
      ...(recordId ? { recordId } : {}),
      ...(changeSummary ? { changeSummary } : {}),
      ...(changedFields?.length ? { changedFields } : {}),
      ...(metadata ? { requestMetadata: metadata } : {}),
      ...rest,
      occurredAt: new Date(),
    });
}
