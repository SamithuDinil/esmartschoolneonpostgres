import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { certificateRequestSchema, certificateTypeLabels } from "@/server/schemas/certificates";
import { requestMetadata, writeAudit } from "@/server/services/audit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function dateValue(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value && "toDate" in value && typeof value.toDate === "function")
    return value.toDate().toISOString();
  return String(value);
}
function serialize(data: FirebaseFirestore.DocumentData, id: string) {
  return {
    id,
    ...data,
    createdAt: dateValue(data.createdAt),
    updatedAt: dateValue(data.updatedAt),
    approvedAt: dateValue(data.approvedAt),
    issuedAt: dateValue(data.issuedAt),
  };
}
function canRead(permissions: readonly string[]) {
  return (
    hasPermission(permissions, "certificate.read") ||
    hasPermission(permissions, "certificate.manage") ||
    hasPermission(permissions, "certificate.approve")
  );
}
export async function GET() {
  const context = await getSchoolContext();
  if (!context || !canRead(context.permissions))
    return NextResponse.json({ error: "Certificate access is restricted." }, { status: 403 });
  try {
    const { db } = getAdminServices();
    const root = db.collection("schools").doc(context.schoolId);
    const [studentsSnap, certificatesSnap, schoolSnap, settingsSnap] = await Promise.all([
      root.collection("students").limit(1000).get(),
      root.collection("certificates").limit(200).get(),
      root.get(),
      root.collection("settings").doc("certificates").get(),
    ]);
    const students = studentsSnap.docs
      .map((doc) => {
        const data = doc.data();
        const verified =
          ["active", "approved"].includes(String(data.status ?? "")) && data.verified !== false;
        return {
          id: doc.id,
          fullName: data.fullName ?? data.nameWithInitials ?? data.name ?? "Unnamed student",
          admissionNumber: data.admissionNumber ?? "—",
          grade: data.grade ?? "—",
          className: data.className ?? "—",
          status: data.status ?? "unknown",
          verified,
        };
      })
      .filter((student) => student.verified);
    const certificates = certificatesSnap.docs
      .map((doc) => serialize(doc.data(), doc.id))
      .sort((a, b) =>
        String(b.issuedAt ?? b.createdAt ?? "").localeCompare(
          String(a.issuedAt ?? a.createdAt ?? ""),
        ),
      );
    const school = schoolSnap.data() ?? {};
    return NextResponse.json(
      {
        certificateTypes: Object.entries(certificateTypeLabels).map(([value, label]) => ({
          value,
          label,
        })),
        students,
        certificates,
        school: {
          name: school.name ?? "My school",
          logoUrl: school.logoUrl ?? null,
          motto: school.motto ?? null,
          address: school.address ?? null,
          principalName: school.principalName ?? settingsSnap.get("principalName") ?? "Principal",
          signatureLabel: settingsSnap.get("signatureLabel") ?? "Authorized signature",
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Certificate records could not be loaded." },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return NextResponse.json({ error: "School access is required." }, { status: 403 });
  const parsed = certificateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid certificate request.", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  const data = parsed.data;
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    if (data.action === "request") {
      if (!hasPermission(context.permissions, "certificate.manage"))
        return NextResponse.json(
          { error: "Certificate request permission is required." },
          { status: 403 },
        );
      if (!data.studentId || !data.certificateType)
        return NextResponse.json(
          { error: "Select a verified student and certificate type." },
          { status: 400 },
        );
      const student = await root.collection("students").doc(data.studentId).get();
      if (
        !student.exists ||
        !["active", "approved"].includes(String(student.get("status") ?? "")) ||
        student.get("verified") === false
      )
        return NextResponse.json(
          { error: "Certificates can only be requested for verified active students." },
          { status: 409 },
        );
      const ref = root.collection("certificates").doc();
      const snapshot = student.data() ?? {};
      await ref.set({
        schoolId: context.schoolId,
        certificateType: data.certificateType,
        certificateTypeLabel: certificateTypeLabels[data.certificateType],
        studentId: student.id,
        studentName:
          snapshot.fullName ?? snapshot.nameWithInitials ?? snapshot.name ?? "Unnamed student",
        admissionNumber: snapshot.admissionNumber ?? "—",
        grade: snapshot.grade ?? "—",
        className: snapshot.className ?? "—",
        dateOfBirth: snapshot.dateOfBirth ?? null,
        status: "draft",
        remarks: data.remarks ?? "",
        requestedBy: context.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAudit(context, "certificate.requested", {
        recordType: "certificate",
        recordId: ref.id,
        changeSummary: `Requested ${certificateTypeLabels[data.certificateType]}`,
        requestMetadata: requestMetadata(request),
      });
      return NextResponse.json({ id: ref.id, status: "draft" }, { status: 201 });
    }
    if (!data.requestId)
      return NextResponse.json({ error: "Certificate request is required." }, { status: 400 });
    const ref = root.collection("certificates").doc(data.requestId);
    const current = await ref.get();
    if (!current.exists)
      return NextResponse.json({ error: "Certificate request not found." }, { status: 404 });
    if (data.action === "approve") {
      if (!hasPermission(context.permissions, "certificate.approve"))
        return NextResponse.json(
          { error: "Certificate approval permission is required." },
          { status: 403 },
        );
      if (current.get("status") !== "draft")
        return NextResponse.json(
          { error: "Only draft certificates can be approved." },
          { status: 409 },
        );
      await ref.update({
        status: "approved",
        approvedBy: context.uid,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
      });
      await writeAudit(context, "certificate.approved", {
        recordType: "certificate",
        recordId: ref.id,
        changeSummary: "Certificate request approved for issuance",
        requestMetadata: requestMetadata(request),
      });
      return NextResponse.json({ ok: true, status: "approved" });
    }
    if (!hasPermission(context.permissions, "certificate.manage"))
      return NextResponse.json(
        { error: "Certificate issuance permission is required." },
        { status: 403 },
      );
    if (current.get("status") !== "approved")
      return NextResponse.json(
        { error: "Required approval must be recorded before issuance." },
        { status: 409 },
      );
    const counterRef = root.collection("counters").doc("certificates");
    const historyRef = root.collection("certificateHistory").doc();
    let certificateNumber = "";
    const now = new Date();
    await db.runTransaction(async (transaction) => {
      const counter = await transaction.get(counterRef);
      const next = Number(counter.get("value") ?? 0) + 1;
      certificateNumber = `CERT-${now.getFullYear()}-${String(next).padStart(6, "0")}`;
      transaction.set(
        counterRef,
        { value: next, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      transaction.update(ref, {
        status: "issued",
        certificateNumber,
        issuedBy: context.uid,
        issuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
      });
      transaction.create(historyRef, {
        ...current.data(),
        schoolId: context.schoolId,
        certificateId: ref.id,
        certificateNumber,
        status: "issued",
        issuedBy: context.uid,
        issuedAt: FieldValue.serverTimestamp(),
        immutable: true,
      });
    });
    await writeAudit(context, "certificate.issued", {
      recordType: "certificate",
      recordId: ref.id,
      changeSummary: `Issued ${certificateNumber}`,
      requestMetadata: requestMetadata(request),
    });
    return NextResponse.json({ ok: true, status: "issued", certificateNumber });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Certificate operation failed." },
      { status: 500 },
    );
  }
}
