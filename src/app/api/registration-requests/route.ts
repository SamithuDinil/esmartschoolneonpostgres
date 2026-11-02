import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission, permissionsForRole, type Role } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/server/rate-limit";
export const dynamic = "force-dynamic";
const allowed = (c: Awaited<ReturnType<typeof getSchoolContext>>) =>
  !!c && (c.role === "principal" || hasPermission(c.permissions, "memberships.manage"));
export async function GET() {
  const c = await getSchoolContext();
  if (!allowed(c))
    return NextResponse.json({ error: "Principal approval access required." }, { status: 403 });
  try {
    const snap = await getAdminServices()
      .db.collection("schools")
      .doc(c!.schoolId)
      .collection("registrationRequests")
      .orderBy("requestedAt", "desc")
      .limit(200)
      .get();
    return NextResponse.json(
      {
        requests: snap.docs.map((d) => ({
          id: d.id,
          fullName: d.get("fullName"),
          email: d.get("email"),
          role: d.get("role"),
          admissionNumber: d.get("admissionNumber") ?? "",
          contactNumber: d.get("contactNumber") ?? "",
          teacherId: d.get("teacherId") ?? "",
          grade: d.get("grade") ?? "",
          className: d.get("className") ?? "",
          subjects: d.get("subjects") ?? [],
          qualifications: d.get("qualifications") ?? "",
          status: d.get("status"),
          requestedAt: d.get("requestedAt")?.toDate?.()?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Registration requests could not be loaded." },
      { status: 500 },
    );
  }
}
export async function PATCH(request: NextRequest) {
  const rate = await consumeRateLimit(
    `registration-review:${requestIp(request)}`,
    60,
    60 * 60 * 1000,
  );
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const c = await getSchoolContext();
  if (!allowed(c))
    return NextResponse.json({ error: "Principal approval access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.uid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(body.uid) ||
    !["approve", "reject"].includes(body.action)
  )
    return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
  const { db } = getAdminServices();
  const school = db.collection("schools").doc(c!.schoolId);
  const ref = school.collection("registrationRequests").doc(body.uid);
  const now = new Date();
  try {
    const result = await db.runTransaction(async (tx) => {
      const req = await tx.get(ref);
      if (!req.exists || req.get("status") !== "pending") throw new Error("REQUEST_NOT_PENDING");
      const uid = String(req.get("uid") ?? "");
      const role = String(req.get("role") ?? "");
      if (uid !== body.uid || !["student", "class_teacher", "subject_teacher"].includes(role))
        throw new Error("INVALID_REQUEST");
      const memberRef = school.collection("memberships").doc(uid);
      const member = await tx.get(memberRef);
      if (body.action === "approve") {
        if (member.exists && member.get("status") === "active") throw new Error("ALREADY_MEMBER");
        if (role === "student" && req.get("admissionNumber")) {
          const dup = await tx.get(
            school
              .collection("students")
              .where("admissionNumber", "==", req.get("admissionNumber"))
              .limit(1),
          );
          if (!dup.empty && dup.docs[0].id !== uid) throw new Error("DUPLICATE_ADMISSION");
        }
        tx.set(
          memberRef,
          {
            uid,
            email: req.get("email"),
            displayName: req.get("fullName"),
            role,
            permissions: [...permissionsForRole(role as Role)],
            status: "active",
            createdAt: now,
            updatedAt: now,
            approvedBy: c!.uid,
          },
          { merge: true },
        );
        tx.set(
          db.collection("users").doc(uid),
          {
            email: req.get("email"),
            displayName: req.get("fullName"),
            activeSchoolId: c!.schoolId,
            updatedAt: now,
          },
          { merge: true },
        );
        if (role === "student")
          tx.set(
            school.collection("students").doc(uid),
            {
              uid,
              fullName: req.get("fullName"),
              admissionNumber: req.get("admissionNumber") ?? "",
              grade: req.get("grade") ?? "",
              className: req.get("className") ?? "",
              phone: req.get("contactNumber") ?? "",
              email: req.get("email"),
              status: "active",
              verified: true,
              createdAt: now,
            },
            { merge: true },
          );
        else
          tx.set(
            school.collection("teachers").doc(uid),
            {
              uid,
              fullName: req.get("fullName"),
              email: req.get("email"),
              phone: req.get("contactNumber") ?? "",
              teacherId: req.get("teacherId") ?? "",
              subjects: req.get("subjects") ?? [],
              qualifications: req.get("qualifications") ?? "",
              role,
              status: "active",
              createdAt: now,
            },
            { merge: true },
          );
      }
      tx.update(ref, {
        status: body.action === "approve" ? "approved" : "rejected",
        decision: body.action,
        decidedAt: now,
        decisionBy: c!.uid,
      });
      tx.create(school.collection("notifications").doc(), {
        recipientUid: uid,
        category: "Administrative",
        title: body.action === "approve" ? "Registration approved" : "Registration not approved",
        message:
          body.action === "approve"
            ? `Your ${role.replaceAll("_", " ")} registration was approved.`
            : `Your ${role.replaceAll("_", " ")} registration was not approved. Contact the school administration for more information.`,
        createdAt: now,
        read: false,
        deepLink: body.action === "approve" ? "/dashboard" : "/registration/pending",
      });
      return { uid, role };
    });
    await school.collection("auditLogs").add({
      schoolId: c!.schoolId,
      actorUid: c!.uid,
      action: body.action === "approve" ? "registration.approved" : "registration.rejected",
      recordType: "registrationRequest",
      recordId: result.uid,
      role: result.role,
      occurredAt: now,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "REQUEST_NOT_PENDING")
      return NextResponse.json({ error: "Request is no longer pending." }, { status: 409 });
    if (code === "ALREADY_MEMBER")
      return NextResponse.json(
        { error: "Account already has an active membership." },
        { status: 409 },
      );
    if (code === "DUPLICATE_ADMISSION")
      return NextResponse.json({ error: "Admission number is already assigned." }, { status: 409 });
    return NextResponse.json({ error: "Request could not be decided." }, { status: 400 });
  }
}
