import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixture = vi.hoisted(() => ({
  context: {
    uid: "owner-1",
    schoolId: "school-1",
    role: "school_owner",
    permissions: ["attendance.read", "attendance.mark", "teachers.manage"],
    displayName: "School Owner",
  },
  documents: new Map<string, Record<string, unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/context", () => ({ getSchoolContext: async () => fixture.context }));
vi.mock("@/server/permissions", () => ({
  hasPermission: (permissions: string[], permission: string) => permissions.includes(permission),
}));
vi.mock("@/server/csrf", () => ({ hasValidCsrf: () => true }));
vi.mock("@/lib/firebase/admin", () => {
  type Op = {
    kind: "set" | "create" | "update";
    path: string;
    data: Record<string, unknown>;
    merge?: boolean;
  };
  interface FakeDocument {
    id: string;
    path: string;
    get(): Promise<FakeSnapshot>;
    set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
    create(data: Record<string, unknown>): Promise<void>;
    update(data: Record<string, unknown>): Promise<void>;
    delete(): Promise<void>;
    collection(name: string): FakeCollection;
  }
  interface FakeSnapshot {
    id: string;
    exists: boolean;
    data(): Record<string, unknown> | undefined;
    get(key: string): unknown;
    ref: FakeDocument;
  }
  interface FakeQuerySnapshot {
    docs: FakeSnapshot[];
    size: number;
    empty: boolean;
  }
  interface FakeQuery {
    where(field: string, operator: string, value: unknown): FakeQuery;
    orderBy(field?: string, direction?: string): FakeQuery;
    limit(limit: number): FakeQuery;
    get(): Promise<FakeQuerySnapshot>;
  }
  interface FakeCollection extends FakeQuery {
    id: string;
    doc(id?: string): FakeDocument;
    add(data: Record<string, unknown>): Promise<FakeDocument>;
  }
  interface FakeTransaction {
    get(ref: FakeDocument): Promise<FakeSnapshot>;
    set(ref: FakeDocument, data: Record<string, unknown>, options?: { merge?: boolean }): FakeTransaction;
    create(ref: FakeDocument, data: Record<string, unknown>): FakeTransaction;
    update(ref: FakeDocument, data: Record<string, unknown>): FakeTransaction;
  }

  const document = (path: string): FakeDocument => ({
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => snapshot(path),
    set: async (data, options) => {
      fixture.documents.set(path, options?.merge
        ? { ...(fixture.documents.get(path) ?? {}), ...data }
        : data);
    },
    create: async (data) => { fixture.documents.set(path, data); },
    update: async (data) => {
      fixture.documents.set(path, { ...(fixture.documents.get(path) ?? {}), ...data });
    },
    delete: async () => { fixture.documents.delete(path); },
    collection: (name) => collection(`${path}/${name}`),
  });
  const snapshot = (path: string): FakeSnapshot => {
    const data = fixture.documents.get(path);
    return {
      id: path.split("/").at(-1) ?? "",
      exists: data !== undefined,
      data: () => data,
      get: (key) => data?.[key],
      ref: document(path),
    };
  };
  const query = (
    path: string,
    filters: Array<[string, string, unknown]> = [],
    maximum = Infinity,
  ): FakeQuery => {
    const q: FakeQuery = {
      where: (field, operator, value) => {
        filters.push([field, operator, value]);
        return q;
      },
      orderBy: () => q,
      limit: (limit) => { maximum = limit; return q; },
      get: async () => {
        const depth = path.split("/").length + 1;
        let docs = [...fixture.documents.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && key.split("/").length === depth)
          .map(([key]) => snapshot(key))
          .filter((doc) => filters.every(([field, operator, value]) =>
            operator === "==" ? doc.get(field) === value : true,
          ));
        docs = docs.slice(0, maximum);
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
    return q;
  };
  const collection = (path: string): FakeCollection => ({
    id: path.split("/").at(-1) ?? "",
    doc: (id) => document(`${path}/${id ?? crypto.randomUUID()}`),
    where: (field, operator, value) => query(path).where(field, operator, value),
    orderBy: (field, direction) => query(path).orderBy(field, direction),
    limit: (limit) => query(path).limit(limit),
    get: () => query(path).get(),
    add: async (data) => {
      const ref = document(`${path}/${crypto.randomUUID()}`);
      await ref.set(data);
      return ref;
    },
  });
  const db = {
    collection,
    runTransaction: async <T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> => {
      const operations: Op[] = [];
      const tx: FakeTransaction = {
        get: (ref) => ref.get(),
        set: (ref, data, options) => {
          operations.push({ kind: "set", path: ref.path, data, merge: options?.merge });
          return tx;
        },
        create: (ref, data) => {
          operations.push({ kind: "create", path: ref.path, data });
          return tx;
        },
        update: (ref, data) => {
          operations.push({ kind: "update", path: ref.path, data });
          return tx;
        },
      };
      const result = await callback(tx);
      for (const operation of operations) {
        const old = fixture.documents.get(operation.path) ?? {};
        if (operation.kind === "create" && fixture.documents.has(operation.path))
          throw new Error("exists");
        fixture.documents.set(
          operation.path,
          operation.merge ? { ...old, ...operation.data } : operation.data,
        );
      }
      return result;
    },
  };
  return { getAdminServices: () => ({ db }) };
});

import { GET, POST } from "@/app/api/attendance/route";

const classPath = "schools/school-1/classes/class-a";
const userPath = "schools/school-1/users/teacher-2";
const memberPath = "schools/school-1/memberships/teacher-2";
const coverPath = "schools/school-1/attendanceCovers/class-a_2026-10-30";
const studentPath = "schools/school-1/students/student-1";

describe("temporary attendance class cover", () => {
  beforeEach(() => {
    fixture.documents.clear();
    fixture.context = {
      uid: "owner-1",
      schoolId: "school-1",
      role: "school_owner",
      permissions: ["attendance.read", "attendance.mark", "teachers.manage"],
      displayName: "School Owner",
    };
    fixture.documents.set(classPath, {
      name: "Class 4A",
      grade: "Grade 4",
      section: "A",
      teacherId: "teacher-1",
    });
    fixture.documents.set(studentPath, {
      fullName: "Taylor Student",
      admissionNumber: "A-001",
      grade: "Grade 4",
      className: "Class 4A",
      status: "active",
    });
    fixture.documents.set(userPath, { activeSchoolId: "school-1", displayName: "Sam Substitute" });
    fixture.documents.set(memberPath, {
      displayName: "Sam Substitute",
      role: "subject_teacher",
      status: "active",
    });
  });

  it("assigns one class/date, creates an in-app notification, and grants only that dated cover access", async () => {
    const response = await POST(new NextRequest("http://localhost/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign_cover",
        classId: "class-a",
        date: "2026-10-30",
        teacherUid: "teacher-2",
        reason: "Covering for the class teacher today",
      }),
    }));
    expect(response.status).toBe(201);
    expect(fixture.documents.get(coverPath)).toEqual(expect.objectContaining({
      teacherUid: "teacher-2",
      teacherName: "Sam Substitute",
      date: "2026-10-30",
      status: "active",
    }));
    const notices = [...fixture.documents.entries()]
      .filter(([path]) => path.startsWith("schools/school-1/notifications/"))
      .map(([, value]) => value);
    expect(notices).toEqual([
      expect.objectContaining({
        recipientUid: "teacher-2",
        category: "attendance",
        title: "You’re assigned as class cover",
        deepLink: "/attendance?classId=class-a&date=2026-10-30",
      }),
    ]);

    fixture.context = {
      uid: "teacher-2",
      schoolId: "school-1",
      role: "subject_teacher",
      permissions: ["attendance.read.assigned"],
      displayName: "Sam Substitute",
    };
    const substituteClasses = await GET(new NextRequest(
      "http://localhost/api/attendance?type=classes&date=2026-10-30",
    ));
    expect((await substituteClasses.json()).classes).toEqual([
      expect.objectContaining({ id: "class-a", name: "Class 4A" }),
    ]);
    const substituteDay = await GET(new NextRequest(
      "http://localhost/api/attendance?classId=class-a&date=2026-10-30",
    ));
    expect(substituteDay.status).toBe(200);
    expect((await substituteDay.json()).cover).toEqual(expect.objectContaining({
      teacherUid: "teacher-2",
      teacherName: "Sam Substitute",
    }));
    const markResponse = await POST(new NextRequest("http://localhost/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark",
        classId: "class-a",
        date: "2026-10-30",
        records: [{ studentId: "student-1", status: "present" }],
      }),
    }));
    expect(markResponse.status).toBe(200);

    fixture.context = {
      uid: "teacher-1",
      schoolId: "school-1",
      role: "class_teacher",
      permissions: ["attendance.read.assigned", "attendance.mark.assigned"],
      displayName: "Regular Teacher",
    };
    const regularTeacherClasses = await GET(new NextRequest(
      "http://localhost/api/attendance?type=classes&date=2026-10-30",
    ));
    expect((await regularTeacherClasses.json()).classes).toEqual([]);
    const regularTeacherNextDay = await GET(new NextRequest(
      "http://localhost/api/attendance?type=classes&date=2026-10-31",
    ));
    expect((await regularTeacherNextDay.json()).classes).toEqual([
      expect.objectContaining({ id: "class-a" }),
    ]);
  });

  it("rejects an inactive teacher member", async () => {
    fixture.documents.set(memberPath, {
      displayName: "Sam Substitute",
      role: "subject_teacher",
      status: "inactive",
    });
    const response = await POST(new NextRequest("http://localhost/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign_cover",
        classId: "class-a",
        date: "2026-10-30",
        teacherUid: "teacher-2",
      }),
    }));
    expect(response.status).toBe(400);
    expect(fixture.documents.has(coverPath)).toBe(false);
  });

  it("shows the assigned class to a Teacher as class teacher and loads students labeled 2-A", async () => {
    fixture.context = {
      uid: "teacher-1",
      schoolId: "school-1",
      role: "teacher",
      permissions: ["attendance.read.assigned", "attendance.mark.assigned"],
      displayName: "Class Teacher",
    };
    fixture.documents.set(classPath, {
      name: "A",
      section: "A",
      grade: "Grade 02",
      teacherId: "teacher-1",
    });
    fixture.documents.set(studentPath, {
      fullName: "Taylor Student",
      admissionNumber: "A-001",
      grade: "2",
      className: "2-A",
      status: "active",
    });

    const classResponse = await GET(new NextRequest(
      "http://localhost/api/attendance?type=classes&date=2026-11-02",
    ));
    expect((await classResponse.json()).classes).toEqual([
      expect.objectContaining({ id: "class-a", isClassTeacher: true }),
    ]);

    const dayResponse = await GET(new NextRequest(
      "http://localhost/api/attendance?classId=class-a&date=2026-11-02",
    ));
    expect((await dayResponse.json()).students).toEqual([
      expect.objectContaining({ id: "student-1", fullName: "Taylor Student" }),
    ]);

    const markResponse = await POST(new NextRequest("http://localhost/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark",
        classId: "class-a",
        date: "2026-11-02",
        records: [{ studentId: "student-1", status: "late" }],
      }),
    }));
    expect(markResponse.status).toBe(200);
    expect(fixture.documents.get("schools/school-1/attendanceSessions/class-a_2026-11-02_daily")).toEqual(
      expect.objectContaining({ late: 1, attendancePercentage: 100 }),
    );
  });

  it("rejects attendance marking on Saturday", async () => {
    const response = await POST(new NextRequest("http://localhost/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark",
        classId: "class-a",
        date: "2026-10-31",
        records: [{ studentId: "student-1", status: "present" }],
      }),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("school holidays");
  });
});
