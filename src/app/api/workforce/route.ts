import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { deliverConfiguredNotification } from "@/server/services/notification-delivery";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function denied() {
  return NextResponse.json({ error: "Workforce access denied" }, { status: 403 });
}
function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  )
    return (value as { toDate: () => Date }).toDate().getTime();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
export async function GET(req: NextRequest) {
  const c = await getSchoolContext();
  if (!c) return denied();
  const type = req.nextUrl.searchParams.get("type") ?? "teachers";
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    if (type === "teachers") {
      const manage = hasPermission(c.permissions, "teachers.manage");
      const read = hasPermission(c.permissions, "teachers.read");
      const self = ["teacher", "class_teacher", "subject_teacher"].includes(c.role);
      if (!manage && !read && !self) return denied();
      const coll = root.collection("teachers");
      const snap = self && !manage
        ? await coll.where("uid", "==", c.uid).limit(100).get()
        : await coll.orderBy("fullName").limit(300).get();
      const profiles: Array<Record<string, unknown> & { id: string }> = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() ?? {}),
      }));
      const registeredUids = new Set(profiles.map((profile) => String(profile.uid ?? "")).filter(Boolean));
      const memberDocs = manage || read ? (await root.collection("memberships").get()).docs : [];
      const teacherMembers = memberDocs.flatMap((doc) => {
        const member = doc.data() ?? {};
        const role = String(member.role ?? "");
        const status = String(member.status ?? "active");
        if (!(["teacher", "class_teacher", "subject_teacher"].includes(role)) || status !== "active") return [];
        return [{
          uid: doc.id,
          displayName: typeof member.displayName === "string" ? member.displayName : "School user",
          email: typeof member.email === "string" ? member.email : "",
          role,
          status,
          profileRegistered: registeredUids.has(doc.id),
        }];
      });
      const memberByUid = new Map(teacherMembers.map((member) => [member.uid, member]));
      const profileItems: Array<Record<string, unknown> & { id: string }> = profiles.map((profile) => {
        const member = memberByUid.get(String(profile.uid ?? ""));
        return {
          ...profile,
          profileStatus: "Registered",
          memberRole: member?.role ?? "—",
          membershipStatus: member?.status ?? "Not linked",
        };
      });
      const unregisteredMembers: Array<Record<string, unknown> & { id: string }> = teacherMembers
        .filter((member) => !registeredUids.has(member.uid))
        .map((member) => ({
          id: `member-${member.uid}`,
          uid: member.uid,
          employeeNumber: "—",
          fullName: member.displayName,
          email: member.email,
          phone: "",
          subjects: [],
          grades: [],
          classes: [],
          employmentDate: "",
          status: "active",
          profileStatus: "Profile needed",
          memberRole: member.role,
          membershipStatus: "Active",
        }));
      const items: Array<Record<string, unknown> & { id: string }> = [...profileItems, ...unregisteredMembers].sort((a, b) =>
        String(a.fullName ?? "").localeCompare(String(b.fullName ?? "")),
      );
      return NextResponse.json(
        { items, teacherMembers },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (type === "staff") {
      const manage = hasPermission(c.permissions, "staff.manage");
      const read = hasPermission(c.permissions, "staff.read");
      const self =
        ["teacher", "class_teacher", "subject_teacher"].includes(c.role) ||
        c.role === "administrative_staff";
      if (!manage && !read && !self) return denied();
      const coll = root.collection("employees");
      const snap = self && !manage
        ? await coll.where("uid", "==", c.uid).limit(100).get()
        : await coll.orderBy("fullName").limit(300).get();
      return NextResponse.json(
        { items: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (type === "assignments") {
      if (
        !hasPermission(c.permissions, "teachers.read") &&
        !hasPermission(c.permissions, "teachers.self.read")
      )
        return denied();
      const q = root.collection("teacherAssignments");
      const snap = hasPermission(c.permissions, "teachers.manage")
        ? await q.limit(500).get()
        : await q.where("teacherUid", "==", c.uid).limit(200).get();
      return NextResponse.json(
        { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (type === "leaves") {
      const canManage = hasPermission(c.permissions, "leave.manage");
      if (!canManage && !hasPermission(c.permissions, "leave.self.request")) return denied();
      if (canManage) {
        const snap = await root
          .collection("leaveRequests")
          .orderBy("createdAt", "desc")
          .limit(300)
          .get();
        return NextResponse.json(
          { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) },
          { headers: { "Cache-Control": "private,no-store" } },
        );
      }
      const query = root.collection("leaveRequests").where("employeeUid", "==", c.uid);
      let docs: FirebaseFirestore.QueryDocumentSnapshot[];
      try {
        docs = (await query.orderBy("createdAt", "desc").limit(100).get()).docs;
      } catch (cause) {
        const code = String((cause as { code?: string | number }).code ?? "");
        console.warn("workforce leave query used bounded fallback", { schoolId: c.schoolId, code });
        docs = [...(await query.limit(100).get()).docs].sort(
          (a, b) => timestampMillis(b.get("createdAt")) - timestampMillis(a.get("createdAt")),
        );
      }
      return NextResponse.json(
        { items: docs.map((d) => ({ id: d.id, ...d.data() })) },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (type === "attendance") {
      if (
        !hasPermission(c.permissions, "hr.attendance.manage") &&
        !hasPermission(c.permissions, "staff.self.read")
      )
        return denied();
      const snap = hasPermission(c.permissions, "hr.attendance.manage")
        ? await root.collection("workforceAttendance").orderBy("date", "desc").limit(300).get()
        : await root
            .collection("workforceAttendance")
            .where("employeeUid", "==", c.uid)
            .limit(100)
            .get();
      return NextResponse.json(
        { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (type === "payroll") {
      if (!hasPermission(c.permissions, "payroll.manage")) return denied();
      const [enabled, periods] = await Promise.all([
        root.collection("settings").doc("payroll").get(),
        root.collection("payrollPeriods").orderBy("createdAt", "desc").limit(100).get(),
      ]);
      return NextResponse.json(
        {
          enabled: enabled.get("enabled") === true,
          items: periods.docs.map((d) => ({ id: d.id, ...d.data() })),
        },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    return NextResponse.json({ error: "Unknown workforce data" }, { status: 400 });
  } catch (cause) {
    const code = String((cause as { code?: string | number }).code ?? "");
    console.error("workforce GET failed", { type, schoolId: c.schoolId, code }, cause);
    return NextResponse.json({ error: "Workforce data unavailable" }, { status: 500 });
  }
}
const teacherSchema = z.object({
  action: z.literal("create_teacher"),
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(254).optional().or(z.literal("")),
  phone: z.string().max(30).optional().default(""),
  address: z.string().max(500).optional(),
  qualifications: z.string().max(1000).optional(),
  subjects: z.array(z.string().max(80)).max(30).default([]),
  grades: z.array(z.string().max(20)).max(20).default([]),
  classes: z.array(z.string().max(40)).max(50).default([]),
  employmentDate: z.string().date(),
  status: z.enum(["active", "on_leave", "inactive"]).default("active"),
  uid: z.string().optional(),
});
const employeeSchema = z.object({
  action: z.literal("create_employee"),
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(254).optional().or(z.literal("")),
  phone: z.string().max(30).optional().default(""),
  address: z.string().max(500).optional(),
  department: z.enum([
    "office",
    "accounting",
    "library",
    "laboratory",
    "maintenance",
    "security",
    "transport",
    "other",
  ]),
  position: z.string().max(100),
  employmentDate: z.string().date(),
  status: z.enum(["active", "on_leave", "inactive"]).default("active"),
  uid: z.string().optional(),
});
const assignmentSchema = z.object({
  action: z.literal("assign_teacher"),
  teacherUid: z.string().min(1),
  subject: z.string().min(1).max(80),
  grade: z.string().min(1).max(30),
  className: z.string().min(1).max(40),
  day: z.string().max(20).optional(),
  period: z.string().max(50).optional(),
  room: z.string().max(60).optional(),
  classTeacher: z.boolean().default(false),
});
const leaveSchema = z.object({
  action: z.literal("request_leave"),
  startDate: z.string().date(),
  endDate: z.string().date(),
  leaveType: z.string().min(2).max(60),
  reason: z.string().max(1000),
});
const attendanceSchema = z.object({
  action: z.literal("mark_attendance"),
  employeeUid: z.string().optional(),
  status: z.enum(["present", "absent", "late", "leave"]),
  date: z.string().date(),
  notes: z.string().max(300).optional(),
});
const payrollSchema = z.object({
  action: z.literal("payroll_period"),
  name: z.string().min(2).max(80),
  startDate: z.string().date(),
  endDate: z.string().date(),
  salaryStructure: z.record(z.string(), z.number().nonnegative()).default({}),
});
const punchSchema = z.object({
  action: z.enum(["check_in", "check_out"]),
  date: z.string().date(),
});
const postSchema = z.discriminatedUnion("action", [
  teacherSchema,
  employeeSchema,
  assignmentSchema,
  leaveSchema,
  attendanceSchema,
  payrollSchema,
  punchSchema,
]);
export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c) return denied();
  const p = postSchema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return NextResponse.json(
      { error: "Invalid workforce request", fields: p.error.flatten().fieldErrors },
      { status: 400 },
    );
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    const data = p.data;
    if (data.action === "check_in" || data.action === "check_out") {
      if (
        !hasPermission(c.permissions, "staff.self.read") &&
        !hasPermission(c.permissions, "teachers.self.read") &&
        !hasPermission(c.permissions, "hr.attendance.manage")
      )
        return denied();
      const collection = root.collection("workforceAttendance"),
        ref = collection.doc(`${c.uid}_${data.date}`),
        existing = await ref.get();
      if (data.action === "check_out" && !existing.exists)
        return NextResponse.json({ error: "Check-in record not found" }, { status: 404 });
      const now = new Date(),
        field = data.action === "check_in" ? "checkIn" : "checkOut";
      if (existing.get(field))
        return NextResponse.json(
          { error: `${data.action} already recorded for this date` },
          { status: 409 },
        );
      await ref.set(
        {
          employeeUid: c.uid,
          date: data.date,
          [field]: now.toISOString(),
          schoolId: c.schoolId,
          updatedAt: now,
        },
        { merge: true },
      );
      return NextResponse.json({ ok: true, [field]: now.toISOString() }, { status: 201 });
    }
    if (data.action === "create_teacher" || data.action === "create_employee") {
      const teacher = data.action === "create_teacher";
      if (!hasPermission(c.permissions, teacher ? "teachers.manage" : "staff.manage"))
        return denied();
      if (teacher && data.uid) {
        const [linked, membership, existingProfile] = await Promise.all([
          root.collection("users").doc(data.uid).get(),
          root.collection("memberships").doc(data.uid).get(),
          root.collection("teachers").where("uid", "==", data.uid).limit(1).get(),
        ]);
        if (!linked.exists || linked.get("activeSchoolId") !== c.schoolId ||
            !membership.exists || String(membership.get("status") ?? "active") !== "active" ||
            !["teacher", "class_teacher", "subject_teacher"].includes(String(membership.get("role") ?? "")))
          return NextResponse.json(
            { error: "Select an active class teacher or subject teacher account from this school." },
            { status: 400 },
          );
        if (!existingProfile.empty)
          return NextResponse.json({ error: "This teacher already has a registered profile." }, { status: 409 });
      }
      const coll = root.collection(teacher ? "teachers" : "employees"),
        counter = root.collection("counters").doc(teacher ? "employee_teacher" : "employee_staff"),
        ref = coll.doc();
      let employeeNumber = "";
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(counter);
        const n = (snap.get("value") ?? 0) + 1;
        employeeNumber = `${teacher ? "TCH" : "EMP"}-${String(n).padStart(5, "0")}`;
        tx.set(counter, { value: n, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.create(ref, {
          ...data,
          employeeNumber,
          schoolId: c.schoolId,
          uid: data.uid ?? null,
          fullName: data.fullName,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: c.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: teacher ? "teacher.created" : "employee.created",
        recordType: teacher ? "teacher" : "employee",
        recordId: ref.id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ id: ref.id, employeeNumber }, { status: 201 });
    }
    if (data.action === "assign_teacher") {
      if (!hasPermission(c.permissions, "teachers.manage")) return denied();
      const teacher = await root
        .collection("teachers")
        .where("uid", "==", data.teacherUid)
        .limit(1)
        .get();
      if (teacher.empty)
        return NextResponse.json(
          { error: "Teacher account is not registered in this school" },
          { status: 400 },
        );
      const profile = teacher.docs[0].data();
      if (
        !(profile.subjects ?? []).includes(data.subject) ||
        !(profile.classes ?? []).includes(data.className)
      )
        return NextResponse.json(
          { error: "Assignment exceeds this teacher’s registered subject/class authority" },
          { status: 403 },
        );
      const duplicate = await root
        .collection("teacherAssignments")
        .where("teacherUid", "==", data.teacherUid)
        .where("grade", "==", data.grade)
        .where("className", "==", data.className)
        .where("subject", "==", data.subject)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (!duplicate.empty)
        return NextResponse.json(
          { error: "This teacher is already assigned to the same subject and class." },
          { status: 409 },
        );
      const ref = root.collection("teacherAssignments").doc();
      await ref.set({
        ...data,
        schoolId: c.schoolId,
        status: "active",
        createdAt: new Date(),
        createdBy: c.uid,
      });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: "teacher.assignment.created",
        recordId: ref.id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    if (data.action === "request_leave") {
      if (
        !hasPermission(c.permissions, "leave.self.request") &&
        !hasPermission(c.permissions, "leave.manage")
      )
        return denied();
      if (data.endDate < data.startDate)
        return NextResponse.json({ error: "End date must follow start date" }, { status: 400 });
      const ref = root.collection("leaveRequests").doc();
      await ref.set({
        ...data,
        employeeUid: c.uid,
        status: "pending",
        createdAt: new Date(),
        createdBy: c.uid,
        schoolId: c.schoolId,
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    if (data.action === "mark_attendance") {
      const self = data.employeeUid === c.uid || !data.employeeUid;
      if (
        !hasPermission(c.permissions, "hr.attendance.manage") &&
        !(self && hasPermission(c.permissions, "staff.self.read"))
      )
        return denied();
      const employeeUid = hasPermission(c.permissions, "hr.attendance.manage")
        ? (data.employeeUid ?? c.uid)
        : c.uid;
      if (hasPermission(c.permissions, "hr.attendance.manage")) {
        const [teacher, staff] = await Promise.all([
          root.collection("teachers").where("uid", "==", employeeUid).limit(1).get(),
          root.collection("employees").where("uid", "==", employeeUid).limit(1).get(),
        ]);
        if (teacher.empty && staff.empty)
          return NextResponse.json(
            { error: "Employee account is not registered in this school" },
            { status: 404 },
          );
      }
      const ref = root.collection("workforceAttendance").doc(`${employeeUid}_${data.date}`);
      await ref.set(
        { ...data, employeeUid, schoolId: c.schoolId, markedBy: c.uid, createdAt: new Date() },
        { merge: true },
      );
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    if (data.action === "payroll_period") {
      if (!hasPermission(c.permissions, "payroll.manage")) return denied();
      const config = await root.collection("settings").doc("payroll").get();
      if (config.get("enabled") !== true)
        return NextResponse.json(
          {
            error:
              "Payroll is disabled for this school. Enable it through authorized school policy configuration before use.",
          },
          { status: 409 },
        );
      const ref = root.collection("payrollPeriods").doc();
      await ref.set({
        ...data,
        status: "draft",
        createdAt: new Date(),
        createdBy: c.uid,
        schoolId: c.schoolId,
      });
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }
    return NextResponse.json({ error: "Unsupported operation" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Workforce record could not be saved" }, { status: 500 });
  }
}
const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_employee"),
    id: z.string().min(1),
    employeeType: z.enum(["teacher", "staff"]),
    fullName: z.string().min(2).optional(),
    email: z.email().or(z.literal("")).optional(),
    phone: z.string().max(30).optional(),
    address: z.string().max(500).optional(),
    qualifications: z.string().max(1000).optional(),
    subjects: z.array(z.string()).optional(),
    grades: z.array(z.string()).optional(),
    classes: z.array(z.string()).optional(),
    department: z.string().optional(),
    position: z.string().optional(),
    status: z.enum(["active", "on_leave", "inactive"]).optional(),
  }),
  z.object({
    action: z.literal("decide_leave"),
    id: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("deactivate_assignment"),
    id: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
]);
export async function PATCH(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c) return denied();
  const p = patchSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    if (p.data.action === "decide_leave") {
      if (!hasPermission(c.permissions, "leave.manage")) return denied();
      const { id, decision, reason } = p.data;
      const ref = root.collection("leaveRequests").doc(id);
      const auditRef = root.collection("auditLogs").doc();
      const decisionAt = new Date();
      let employeeUid = "";
      let snapForMessage: FirebaseFirestore.DocumentData = {};
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return "missing" as const;
        if (snap.get("status") !== "pending") return "decided" as const;
        const owner = snap.get("employeeUid");
        if (typeof owner !== "string" || !owner) return "invalid" as const;
        employeeUid = owner;
        snapForMessage = snap.data() ?? {};
        const notificationRef = root.collection("notifications").doc();
        tx.update(ref, {
          status: decision,
          decisionReason: reason ?? "",
          decidedBy: c.uid,
          decidedAt: decisionAt,
        });
        tx.create(notificationRef, {
          recipientUid: owner,
          category: "administrative",
          type: "leave_decision",
          title: `Leave request ${decision}`,
          message: `Your ${String(snap.get("leaveType") ?? "leave")} request for ${String(snap.get("startDate") ?? "")} to ${String(snap.get("endDate") ?? "")} was ${decision}.${reason ? ` Reason: ${reason}` : ""}`,
          deepLink: "/teacher",
          recordId: ref.id,
          read: false,
          archived: false,
          createdAt: decisionAt,
          schoolId: c.schoolId,
        });
        tx.create(auditRef, {
          schoolId: c.schoolId,
          actorUid: c.uid,
          action: `leave.${decision}`,
          recordId: id,
          recordType: "leaveRequest",
          occurredAt: decisionAt,
        });
        return "ok" as const;
      });
      if (outcome === "missing")
        return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
      if (outcome === "decided")
        return NextResponse.json(
          { error: "This leave request has already been decided." },
          { status: 409 },
        );
      if (outcome === "invalid")
        return NextResponse.json({ error: "Leave request has no valid owner." }, { status: 409 });
      let deliveries: Awaited<ReturnType<typeof deliverConfiguredNotification>> = [];
      try {
        const [settings, teacher, employee] = await Promise.all([
          root.collection("settings").doc("system").get(),
          root.collection("teachers").where("uid", "==", employeeUid).limit(1).get(),
          root.collection("employees").where("uid", "==", employeeUid).limit(1).get(),
        ]);
        const channels = settings.data()?.notifications ?? {};
        const profile = teacher.docs[0]?.data() ?? employee.docs[0]?.data() ?? {};
        deliveries = await deliverConfiguredNotification({
          channels,
          emailTo: typeof profile.email === "string" ? profile.email : undefined,
          smsTo: typeof profile.phone === "string" ? profile.phone : undefined,
          subject: `Leave request ${decision}`,
          message: `Your ${String(snapForMessage.leaveType ?? "leave")} request for ${String(snapForMessage.startDate ?? "")} to ${String(snapForMessage.endDate ?? "")} was ${decision}.${reason ? ` Reason: ${reason}` : ""}`,
        });
        if (deliveries.length)
          await root.collection("notificationDeliveryLogs").add({
            schoolId: c.schoolId,
            recipientUid: employeeUid,
            recordType: "leaveRequest",
            recordId: id,
            deliveries,
            createdAt: decisionAt,
          });
      } catch {
        /* Decision and in-app notice persist even if external delivery is unavailable. */
      }
      return NextResponse.json({ ok: true, deliveries });
    }
    if (p.data.action === "deactivate_assignment") {
      if (!hasPermission(c.permissions, "teachers.manage")) return denied();
      const ref = root.collection("teacherAssignments").doc(p.data.id);
      const snap = await ref.get();
      if (!snap.exists)
        return NextResponse.json({ error: "Teacher assignment not found" }, { status: 404 });
      await ref.update({
        status: "inactive",
        endedAt: new Date(),
        endedBy: c.uid,
        endReason: p.data.reason ?? "",
        updatedAt: new Date(),
      });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: "teacher.assignment.deactivated",
        recordId: p.data.id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ ok: true });
    }
    const { id, employeeType, ...fields } = p.data;
    if (
      !hasPermission(c.permissions, employeeType === "teacher" ? "teachers.manage" : "staff.manage")
    )
      return denied();
    await root
      .collection(employeeType === "teacher" ? "teachers" : "employees")
      .doc(id)
      .update({ ...fields, updatedAt: new Date(), updatedBy: c.uid });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Workforce update failed" }, { status: 500 });
  }
}
