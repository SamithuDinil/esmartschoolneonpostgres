import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
type GuardianChild = {
  id: string;
  fullName: string;
  admissionNumber: string;
  grade: string;
  className: string;
  relationship: string;
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const c = await getSchoolContext();
  if (!c) return NextResponse.json({ error: "School access required" }, { status: 403 });
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    if (c.role === "parent") {
      const links = await root
        .collection("studentGuardianLinks")
        .where("guardianUid", "==", c.uid)
        .where("status", "==", "active")
        .get();
      const children = await Promise.all(
        links.docs.map(async (l) => {
          const s = await root.collection("students").doc(l.get("studentId")).get();
          return s.exists
            ? {
                id: s.id,
                fullName: s.get("fullName"),
                admissionNumber: s.get("admissionNumber"),
                grade: s.get("grade"),
                className: s.get("className"),
                relationship: l.get("relationship"),
                accessPermissions: l.get("accessPermissions") ?? [],
              }
            : null;
        }),
      );
      return NextResponse.json(
        { children: children.filter(Boolean) },
        { headers: { "Cache-Control": "private,no-store" } },
      );
    }
    if (!hasPermission(c.permissions, "guardians.read"))
      return NextResponse.json({ error: "Guardian directory access denied" }, { status: 403 });
    const picker = request.nextUrl.searchParams.get("picker");
    if (picker === "guardians" || picker === "students") {
      if (!hasPermission(c.permissions, "guardians.manage"))
        return NextResponse.json({ error: "Guardian management permission required" }, { status: 403 });
      const search = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
      const terms = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0)
        return NextResponse.json({ options: [] }, { headers: { "Cache-Control": "private,no-store" } });
      if (picker === "guardians") {
        const guardians = await root.collection("guardians").orderBy("fullName").get();
        const options = guardians.docs.flatMap((doc) => {
          const data = doc.data() ?? {};
          const option = {
            id: doc.id,
            fullName: typeof data.fullName === "string" ? data.fullName : "Guardian",
            email: typeof data.email === "string" ? data.email : "",
            phone: typeof data.phone === "string" ? data.phone : "",
          };
          const fields = [option.fullName, option.email, option.phone].map((value) => value.toLocaleLowerCase());
          return terms.every((term) => fields.some((field) => field.includes(term))) ? [option] : [];
        }).slice(0, 12);
        return NextResponse.json({ options }, { headers: { "Cache-Control": "private,no-store" } });
      }
      const students = await root.collection("students").get();
      const options = students.docs.flatMap((doc) => {
        const data = doc.data() ?? {};
        const option = {
          id: doc.id,
          fullName: typeof data.fullName === "string" ? data.fullName : "Student",
          admissionNumber: typeof data.admissionNumber === "string" ? data.admissionNumber : "",
          grade: typeof data.grade === "string" ? data.grade : "",
          className: typeof data.className === "string" ? data.className : "",
        };
        const fields = [option.fullName, data.preferredName, option.admissionNumber, option.grade, option.className]
          .map((value) => String(value ?? "").toLocaleLowerCase());
        return terms.every((term) => fields.some((field) => field.includes(term))) ? [option] : [];
      }).sort((left, right) => left.fullName.localeCompare(right.fullName)).slice(0, 12);
      return NextResponse.json({ options }, { headers: { "Cache-Control": "private,no-store" } });
    }
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const [docs, links] = await Promise.all([
      root.collection("guardians").orderBy("fullName").get(),
      root.collection("studentGuardianLinks").where("status", "==", "active").get(),
    ]);
    const guardianIds = new Set(docs.docs.map((doc) => doc.id));
    const linksByGuardian = new Map<string, typeof links.docs>();
    const studentIds = new Set<string>();
    for (const link of links.docs) {
      const guardianId = String(link.get("guardianId") ?? "");
      const studentId = String(link.get("studentId") ?? "");
      if (!guardianIds.has(guardianId) || !studentId) continue;
      const related = linksByGuardian.get(guardianId) ?? [];
      related.push(link);
      linksByGuardian.set(guardianId, related);
      studentIds.add(studentId);
    }
    const students = new Map<string, Omit<GuardianChild, "relationship">>();
    const ids = [...studentIds];
    for (let index = 0; index < ids.length; index += 250) {
      const page = await db.getAll(
        ...ids.slice(index, index + 250).map((id) => root.collection("students").doc(id)),
      );
      for (const student of page) {
        if (!student.exists) continue;
        const data = student.data() ?? {};
        students.set(student.id, {
          id: student.id,
          fullName: typeof data.fullName === "string" ? data.fullName : "Student",
          admissionNumber: typeof data.admissionNumber === "string" ? data.admissionNumber : "",
          grade: typeof data.grade === "string" ? data.grade : "",
          className: typeof data.className === "string" ? data.className : "",
        });
      }
    }
    const terms = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rows = docs.docs.map((doc) => {
      const data = doc.data() ?? {};
      const children: GuardianChild[] = (linksByGuardian.get(doc.id) ?? []).flatMap((link) => {
        const studentId = String(link.get("studentId") ?? "");
        const student = students.get(studentId);
        return student
          ? [{
              ...student,
              relationship: typeof link.get("relationship") === "string" ? link.get("relationship") : "Guardian",
            }]
          : [];
      });
      return {
        id: doc.id,
        fullName: typeof data.fullName === "string" ? data.fullName : "Guardian",
        email: typeof data.email === "string" ? data.email : "",
        phone: typeof data.phone === "string" ? data.phone : "",
        children,
      };
    }).filter((guardian) => {
      if (!terms.length) return true;
      const searchable = [guardian.fullName, guardian.email, guardian.phone, ...guardian.children.flatMap((child) => [
        child.fullName,
        child.admissionNumber,
        child.grade,
        child.className,
      ])].map((value) => value.toLocaleLowerCase());
      return terms.every((term) => searchable.some((value) => value.includes(term)));
    });
    const total = rows.length;
    return NextResponse.json(
      { guardians: rows.slice(0, 200), total, truncated: total > 200 },
      { headers: { "Cache-Control": "private,no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Guardian records unavailable" }, { status: 500 });
  }
}
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    fullName: z.string().trim().min(2).max(120),
    relationship: z.string().trim().min(2).max(60),
    phone: z.string().trim().min(7).max(24),
    email: z.email().max(254).or(z.literal("")),
    address: z.string().max(500).optional().default(""),
    occupation: z.string().max(120).optional().default(""),
    emergencyContact: z.boolean().default(false),
    communicationPreferences: z
      .array(z.enum(["email", "sms", "phone", "in_app"]))
      .max(4)
      .default([]),
  }),
  z.object({
    action: z.literal("link"),
    guardianId: z.string().min(1),
    studentId: z.string().min(1),
    relationship: z.string().trim().min(2).max(60),
    guardianUid: z.string().optional(),
    accessPermissions: z
      .array(z.enum(["attendance", "published_results", "fees", "report_cards", "announcements", "assignments"]))
      .max(6)
      .default(["attendance", "published_results", "announcements"]),
  }),
  z.object({
    action: z.literal("update"),
    guardianId: z.string().min(1),
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().max(24).optional(),
    email: z.email().max(254).or(z.literal("")).optional(),
    address: z.string().max(500).optional(),
    occupation: z.string().max(120).optional(),
    emergencyContact: z.boolean().optional(),
    communicationPreferences: z
      .array(z.enum(["email", "sms", "phone", "in_app"]))
      .max(4)
      .optional(),
  }),
]);
export async function POST(req: NextRequest) {
  if (!hasValidCsrf(req))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const c = await getSchoolContext();
  if (!c || !hasPermission(c.permissions, "guardians.manage"))
    return NextResponse.json({ error: "Guardian management permission required" }, { status: 403 });
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return NextResponse.json(
      { error: "Invalid guardian information", fields: p.error.flatten().fieldErrors },
      { status: 400 },
    );
  const { db } = getAdminServices();
  const root = db.collection("schools").doc(c.schoolId);
  try {
    if (p.data.action === "create") {
      const r = root.collection("guardians").doc();
      const { action, ...record } = p.data;
      await r.set({ ...record, schoolId: c.schoolId, createdAt: new Date(), createdBy: c.uid });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: "guardian.created",
        recordType: "guardian",
        recordId: r.id,
        occurredAt: new Date(),
      });
      return NextResponse.json({ id: r.id }, { status: 201 });
    }
    if (p.data.action === "update") {
      const { guardianId, ...changes } = p.data;
      await root
        .collection("guardians")
        .doc(guardianId)
        .update({ ...changes, updatedAt: new Date(), updatedBy: c.uid });
      await root.collection("auditLogs").add({
        actorUid: c.uid,
        action: "guardian.updated",
        recordType: "guardian",
        recordId: guardianId,
        occurredAt: new Date(),
      });
      return NextResponse.json({ ok: true });
    }
    const student = await root.collection("students").doc(p.data.studentId).get();
    const guardian = await root.collection("guardians").doc(p.data.guardianId).get();
    if (!student.exists || !guardian.exists)
      return NextResponse.json(
        { error: "Student or guardian not found in this school" },
        { status: 404 },
      );
    if (p.data.guardianUid) {
      const account = await getAdminServices().auth.getUser(p.data.guardianUid);
      const storedEmail = String(guardian.get("email") ?? "").toLowerCase();
      if (!account.email || !account.emailVerified || account.email.toLowerCase() !== storedEmail)
        return NextResponse.json(
          { error: "The linked account must have a verified email matching this guardian record" },
          { status: 400 },
        );
    }
    const link = root
      .collection("studentGuardianLinks")
      .doc(`${p.data.studentId}_${p.data.guardianId}`);
    await link.set(
      {
        schoolId: c.schoolId,
        studentId: p.data.studentId,
        guardianId: p.data.guardianId,
        guardianUid: p.data.guardianUid ?? null,
        relationship: p.data.relationship,
        accessPermissions: p.data.accessPermissions,
        status: "active",
        createdAt: new Date(),
        createdBy: c.uid,
      },
      { merge: true },
    );
    await student.ref.update({
      guardianIds: Array.from(new Set([...(student.get("guardianIds") ?? []), p.data.guardianId])),
    });
    await root.collection("auditLogs").add({
      actorUid: c.uid,
      action: "guardian.linked",
      recordType: "student",
      recordId: p.data.studentId,
      guardianId: p.data.guardianId,
      occurredAt: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Guardian operation could not be saved" }, { status: 500 });
  }
}
