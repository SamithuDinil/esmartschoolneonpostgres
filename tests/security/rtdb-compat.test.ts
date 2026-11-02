import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { createRtdbFirestoreCompat, FieldValue } from "../../src/lib/firebase/rtdb-firestore-compat";

const projectId = "demo-edusphere";
const appName = "rtdb-compat-tests";
const basePath = "__edusphere_documents";
let db: ReturnType<typeof createRtdbFirestoreCompat>;
let database: ReturnType<typeof getDatabase>;
let app: ReturnType<typeof initializeApp>;

beforeAll(() => {
  app = initializeApp({
    projectId,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
  }, appName);
  database = getDatabase(app);
  db = createRtdbFirestoreCompat(database);
});

afterAll(async () => {
  await database?.ref(basePath).remove();
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  await database.ref(basePath).remove();
});

describe("Realtime Database document adapter", () => {
  it("writes and reads nested school documents while preserving subcollections", async () => {
    const school = db.collection("schools").doc("school-a");
    const student = school.collection("students").doc("student-a");
    await school.set({ name: "Test school", active: true });
    await student.set({ fullName: "Example Student", status: "active" });
    const [schoolSnapshot, studentSnapshot] = await Promise.all([school.get(), student.get()]);
    expect(schoolSnapshot.data()?.name).toBe("Test school");
    expect(studentSnapshot.data()?.fullName).toBe("Example Student");
    expect(studentSnapshot.ref.path).toBe("schools/school-a/students/student-a");
  });

  it("supports where/order/limit and document-name cursor pagination", async () => {
    const students = db.collection("schools/school-a/students");
    await students.doc("s1").set({ status: "active", fullName: "A" });
    await students.doc("s2").set({ status: "active", fullName: "B" });
    await students.doc("s3").set({ status: "inactive", fullName: "C" });
    const query = students.where("status", "==", "active").orderBy("__name__").limit(1);
    const first = await query.get();
    expect(first.docs.map((doc) => doc.id)).toEqual(["s1"]);
    const second = await students.where("status", "==", "active").orderBy("__name__").startAfter(first.docs[0]).limit(1).get();
    expect(second.docs.map((doc) => doc.id)).toEqual(["s2"]);
    expect((await query.count().get()).data().count).toBe(1);
    const projected = await students.where("status", "==", "active").select("status").get();
    expect(projected.docs[0].data()).toEqual({ status: "active" });
    const bulk = await db.getAll(students.doc("s1"), students.doc("s2"));
    expect(bulk.map((doc) => doc.exists)).toEqual([true, true]);
  });

  it("applies server timestamps, arrayUnion, dotted updates, and delete transforms", async () => {
    const ref = db.collection("schools/school-a/students").doc("s1");
    await ref.set({ labels: ["first"], profile: { name: "Old", city: "Kandy" }, removeMe: true });
    await ref.update({
      labels: FieldValue.arrayUnion("second", "first"),
      "profile.name": "Updated",
      removeMe: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const data = (await ref.get()).data()!;
    expect(data.labels).toEqual(["first", "second"]);
    expect(data.profile).toEqual({ name: "Updated", city: "Kandy" });
    expect(data.removeMe).toBeUndefined();
    expect(typeof data.updatedAt).toBe("string");
  });

  it("preserves guarded multi-document updates in an RTDB transaction", async () => {
    const counter = db.collection("schools/school-a/counters").doc("students");
    await counter.set({ value: 2 });
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(counter);
      transaction.update(counter, { value: Number(snapshot.get("value")) + 1 });
    });
    expect((await counter.get()).get("value")).toBe(3);
  });

  it("commits a batch atomically at the common RTDB ancestor", async () => {
    const school = db.collection("schools").doc("school-a");
    const batch = db.batch();
    batch.set(school, { name: "Batch school" });
    batch.set(school.collection("settings").doc("general"), { locale: "en" });
    await batch.commit();
    expect((await school.get()).get("name")).toBe("Batch school");
    expect((await school.collection("settings").doc("general").get()).get("locale")).toBe("en");
  });
});
