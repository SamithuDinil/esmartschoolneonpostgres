import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadString } from "firebase/storage";

const projectId = "demo-edusphere";
const bucket = `gs://${projectId}.appspot.com`;
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId,
    database: { rules: await readFile("database.rules.json", "utf8") },
    firestore: { rules: await readFile("firestore.rules", "utf8") },
    storage: { rules: await readFile("storage.rules", "utf8") },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearDatabase();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "schools/school-a"), { name: "Fictional Test School A" });
    await setDoc(doc(db, "schools/school-b"), { name: "Fictional Test School B" });
    await setDoc(doc(db, "schools/school-a/memberships/member-a"), {
      uid: "member-a",
      status: "active",
      permissions: ["students.read", "documents.read", "documents.write"],
    });
    await setDoc(doc(db, "schools/school-b/memberships/member-b"), {
      uid: "member-b",
      status: "active",
      permissions: ["students.read", "documents.read", "documents.write"],
    });
    await setDoc(doc(db, "schools/school-a/students/student-a"), {
      fullName: "Fictional Student A",
    });
    await setDoc(doc(db, "schools/school-a/welfareRecords/private-a"), {
      notes: "fictional restricted test fixture",
    });
    await uploadString(
      ref(context.storage(bucket), "schools/school-a/students/student-a/report.pdf"),
      "fictional test PDF bytes",
      "raw",
      { contentType: "application/pdf" },
    );
  });
});

describe("Realtime Database client access", () => {
  it("denies unauthenticated and authenticated client reads and writes", async () => {
    const unauthenticated = env.unauthenticatedContext().database();
    const authenticated = env.authenticatedContext("member-a").database();
    await assertFails(unauthenticated.ref("/__edusphere_documents/schools").once("value"));
    await assertFails(authenticated.ref("/__edusphere_documents/schools").once("value"));
    await assertFails(authenticated.ref("/__edusphere_documents/schools/school-a").set({ name: "not allowed" }));
  });

  it("denies unmatched and app document paths even when data exists", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.database().ref("/__edusphere_documents/users/member-a/__data").set({ displayName: "Fixture" });
    });
    const database = env.authenticatedContext("member-a").database();
    await assertFails(database.ref("/__edusphere_documents/users/member-a/__data").once("value"));
    await assertFails(database.ref("/unlisted/private").set({ content: "blocked" }));
  });
});

describe("Firestore tenant rules", () => {
  it("allows active school members to read authorized student documents", async () => {
    const db = env.authenticatedContext("member-a").firestore();
    await assertSucceeds(getDoc(doc(db, "schools/school-a/students/student-a")));
  });

  it("denies access to another school's records", async () => {
    const db = env.authenticatedContext("member-a").firestore();
    await assertFails(getDoc(doc(db, "schools/school-b/students/student-b")));
  });

  it("denies client-side student writes and sensitive welfare reads", async () => {
    const db = env.authenticatedContext("member-a").firestore();
    await assertFails(
      setDoc(doc(db, "schools/school-a/students/student-new"), { fullName: "Not allowed" }),
    );
    await assertFails(getDoc(doc(db, "schools/school-a/welfareRecords/private-a")));
  });

  it("lets a user update allowed profile fields but never the active school", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/member-a"), {
        displayName: "Old",
        activeSchoolId: "school-a",
      });
    });
    const db = env.authenticatedContext("member-a").firestore();
    await assertSucceeds(updateDoc(doc(db, "users/member-a"), { displayName: "New" }));
    await assertFails(updateDoc(doc(db, "users/member-a"), { activeSchoolId: "school-b" }));
  });

  it("denies unauthenticated and unlisted paths", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "schools/school-a/students/student-a")));
    await assertFails(getDoc(doc(db, "arbitrary/secret")));
  });
});

describe("Storage access stays disabled until record-bound uploads exist", () => {
  it("denies reads of even an existing same-school student document", async () => {
    const storage = env.authenticatedContext("member-a").storage(bucket);
    await assertFails(getBytes(ref(storage, "schools/school-a/students/student-a/report.pdf")));
  });

  it("denies same-school and cross-school uploads despite broad school permission grants", async () => {
    const storage = env.authenticatedContext("member-a").storage(bucket);
    await assertFails(
      uploadString(
        ref(storage, "schools/school-a/students/student-a/new.pdf"),
        "not enabled",
        "raw",
        { contentType: "application/pdf" },
      ),
    );
    await assertFails(
      uploadString(
        ref(storage, "schools/school-b/students/student-b/new.pdf"),
        "not allowed",
        "raw",
        { contentType: "application/pdf" },
      ),
    );
  });
});
