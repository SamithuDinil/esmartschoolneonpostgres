import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const writes: Array<{ path: string; data: Record<string, unknown> }> = [];

vi.mock("server-only", () => ({}));
vi.mock("@/server/csrf", () => ({ hasValidCsrf: () => true }));
vi.mock("@/server/context", () => ({
  getSchoolContext: async () => ({
    uid: "owner",
    schoolId: "s1",
    role: "school_owner",
    permissions: ["school.manage"],
    displayName: "Owner",
  }),
}));
vi.mock("@/lib/firebase/admin", () => {
  function queryFor(path: string, filtered = false) {
    return {
      where: () => queryFor(path, true),
      limit: () => queryFor(path, filtered),
      get: async () => {
        const docs = !filtered && path.endsWith("/subjects")
          ? [{ id: "science", get: (key: string) => ({ name: "Science", grade: "Grade 02" })[key], data: () => ({ name: "Science", grade: "Grade 02" }) }]
          : [];
        return { empty: docs.length === 0, docs };
      },
    };
  }
  function collection(path: string): unknown {
    return {
      doc: (id = "auto1") => {
        const docPath = `${path}/${id}`;
        const values: Record<string, unknown> = docPath === "schools/s1/memberships/teacher-1"
          ? { role: "class_teacher", status: "active", displayName: "Teacher One" }
          : {};
        return {
          id,
          path: docPath,
          ref: { path: docPath },
          get: async () => ({
            exists: true,
            id,
            ref: { path: docPath },
            data: () => values,
            get: (key: string) => values[key as keyof typeof values],
          }),
          set: async (data: Record<string, unknown>) => {
            writes.push({ path: docPath, data });
          },
          update: async () => undefined,
          collection: (child: string) => collection(`${docPath}/${child}`),
        };
      },
      add: async () => ({ id: "audit1" }),
      where: () => queryFor(path, true),
      limit: () => queryFor(path),
    };
  }
  return {
    getAdminServices: () => ({
      db: {
        collection: (name: string) => collection(name),
        runTransaction: async (callback: (transaction: {
          create: (ref: { path: string }, data: Record<string, unknown>) => void;
          set: (ref: { path: string }, data: Record<string, unknown>, options?: unknown) => void;
        }) => Promise<void>) => callback({
          create: (ref, data) => writes.push({ path: ref.path, data }),
          set: (ref, data) => writes.push({ path: ref.path, data }),
        }),
        batch: () => ({
          update: () => undefined,
          set: () => undefined,
          commit: async () => undefined,
        }),
      },
    }),
  };
});

import { PATCH, POST } from "@/app/api/administration/route";

function request(method: string, url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const blankForm = {
  name: "",
  code: "",
  status: "active",
  startDate: "",
  endDate: "",
  grade: "",
  teacherId: "",
  room: "",
  description: "",
  date: "",
  section: "",
  capacity: undefined,
  academicYearId: "",
  subjectCode: "",
  category: "core",
  optional: false,
  schoolType: "",
  streams: undefined,
  combinations: undefined,
};

beforeEach(() => {
  writes.length = 0;
});

describe("administration route as school owner", () => {
  it("creates a grade from the panel payload with blank date fields", async () => {
    const response = await POST(
      request("POST", "/api/administration?group=grades", { ...blankForm, name: "Grade 6" }),
    );
    expect(response.status).toBe(201);
    expect(writes[0].path).toContain("grades");
    expect(writes[0].data).not.toHaveProperty("startDate");
  });

  it("creates a class, subject and classroom with blank optional fields", async () => {
    for (const [group, extra] of [
      ["classes", { name: "A", grade: "Grade 06", section: "A", capacity: 30 }],
      ["subjects", { name: "Science", grade: "Grade 6" }],
      ["classrooms", { name: "Lab 1", room: "L1" }],
    ] as const) {
      const response = await POST(
        request("POST", `/api/administration?group=${group}`, { ...blankForm, ...extra }),
      );
      expect(response.status, group).toBe(201);
    }
  });

  it("creates a Grade 02 B class and assigns its class teacher to a configured subject", async () => {
    const response = await POST(
      request("POST", "/api/administration?group=classes", {
        ...blankForm,
        name: "B",
        grade: "Grade 2",
        section: "B",
        capacity: 30,
        teacherId: "teacher-1",
        teacherAssignments: [{ teacherUid: "teacher-1", subject: "Science" }],
      }),
    );
    expect(response.status).toBe(201);
    expect(writes).toContainEqual(expect.objectContaining({
      path: expect.stringContaining("/classes/"),
      data: expect.objectContaining({ name: "B", grade: "Grade 02", section: "B", teacherId: "teacher-1" }),
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      path: expect.stringContaining("/teacherAssignments/"),
      data: expect.objectContaining({
        teacherUid: "teacher-1",
        subject: "Science",
        grade: "Grade 02",
        className: "B",
        classTeacher: true,
      }),
    }));
  });

  it("creates an academic year with dates", async () => {
    const response = await POST(
      request("POST", "/api/administration?group=academicYears", {
        ...blankForm,
        name: "2026",
        status: "draft",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }),
    );
    expect(response.status).toBe(201);
  });

  it("still rejects genuinely invalid grade names with a readable error", async () => {
    const response = await POST(
      request("POST", "/api/administration?group=grades", { ...blankForm, name: "Grade 20" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Grade 1 through Grade 13");
  });

  it("saves the school profile with an empty email and clears optional text", async () => {
    const response = await PATCH(
      request("PATCH", "/api/administration", {
        name: "My School",
        email: "",
        motto: "",
        website: "",
        phone: "0112345678",
      }),
    );
    expect(response.status).toBe(200);
    expect(writes[0].data).toMatchObject({ name: "My School", motto: "" });
    expect(writes[0].data).not.toHaveProperty("email");
  });
});
