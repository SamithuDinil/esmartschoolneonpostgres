import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference, Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase/admin";
import { classRoster, notificationRecipientsForStudents } from "@/server/services/assignments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TIME_BUDGET_MS = 240_000; // stop starting new work well before maxDuration; remaining items are picked up next run
const PAGE_SIZE = 50;
const CONCURRENCY = 8;
const LEASE_MS = 6 * 60 * 1000;
const OVERDUE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const SUBMITTED = new Set(["submitted", "submitted_late", "under_review", "reviewed", "published"]);

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !supplied) return false;
  const expectedHash = createHmac("sha256", "edu-cron").update(secret).digest();
  const suppliedHash = createHmac("sha256", "edu-cron").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

/** Schools are the parent of the assignment's parent collection: schools/{schoolId}/assignments/{id}. */
function schoolRootOf(doc: QueryDocumentSnapshot): DocumentReference | null {
  const school = doc.ref.parent.parent;
  return school && school.parent.id === "schools" ? school : null;
}

/** Walks a query page by page (cursor-based) so nothing is silently skipped; stops when the time budget is spent. */
async function forEachPage(
  query: Query,
  deadline: number,
  handle: (docs: QueryDocumentSnapshot[]) => Promise<void>,
) {
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    if (Date.now() > deadline) return true; // more work may remain
    const page = await (cursor ? query.startAfter(cursor) : query).limit(PAGE_SIZE).get();
    if (page.empty) return false;
    await handle(page.docs);
    if (page.size < PAGE_SIZE) return false;
    cursor = page.docs[page.docs.length - 1];
  }
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item).catch((error) =>
          console.error(
            "[cron/assignments] item failed:",
            error instanceof Error ? error.message : error,
          ),
        );
      }
    }),
  );
}

async function queueNotifications(
  root: DocumentReference,
  schoolId: string,
  entries: Array<{ id: string; payload: FirebaseFirestore.DocumentData }>,
) {
  if (!entries.length) return;
  const writer = getAdminServices().db.bulkWriter();
  writer.onWriteError((error) => error.code !== 6 && error.failedAttempts < 3); // 6 = ALREADY_EXISTS: deterministic IDs make re-queueing a no-op
  for (const entry of entries)
    writer
      .create(root.collection("assignmentNotifications").doc(entry.id), {
        ...entry.payload,
        schoolId,
        createdAt: new Date(),
        deliveryStatus: "queued",
      })
      .catch(() => undefined);
  await writer.close();
}

/** Claims an assignment for this run so overlapping cron invocations do not process it twice. */
async function claim(
  ref: DocumentReference,
  valid: (data: FirebaseFirestore.DocumentData) => boolean,
) {
  return getAdminServices().db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !valid(data) || Number(data.cronLeaseUntil ?? 0) > Date.now()) return null;
    tx.update(ref, { cronLeaseUntil: Date.now() + LEASE_MS });
    return data;
  });
}

async function publishScheduled(doc: QueryDocumentSnapshot, now: Date, nowIso: string) {
  const root = schoolRootOf(doc);
  if (!root) return false;
  const data = await claim(
    doc.ref,
    (current) =>
      current.status === "scheduled" &&
      typeof current.publishAt === "string" &&
      current.publishAt <= nowIso,
  );
  if (!data) return false;
  const db = getAdminServices().db;
  const schoolId = root.id;
  const roster = await classRoster(root, data);
  for (let i = 0; i < roster.length; i += 400) {
    const batch = db.batch();
    for (const student of roster.slice(i, i + 400))
      batch.set(
        doc.ref.collection("recipients").doc(student.id),
        {
          studentId: student.id,
          grade: data.grade,
          className: data.className,
          academicYearId: data.academicYearId,
          addedAt: now,
          schoolId,
        },
        { merge: true },
      );
    await batch.commit();
  }
  const targets = await notificationRecipientsForStudents(
    root,
    roster.map((student) => ({ id: student.id, ...student.data() })),
  );
  await queueNotifications(
    root,
    schoolId,
    roster.flatMap((student) => {
      const targetUids = targets.get(student.id) ?? [];
      return targetUids.length
        ? [
            {
              id: `published_${doc.id}_${student.id}`,
              payload: {
                type: "assignment_published",
                title: "New assignment",
                message: `${String(data.title)} has been published.`,
                assignmentId: doc.id,
                studentId: student.id,
                targetUids,
              },
            },
          ]
        : [];
    }),
  );
  // Status flips last: a crash before this point is retried safely because every write above is idempotent.
  await doc.ref.update({
    status: "published",
    publishedAt: now,
    publishedBy: "system:cron",
    recipientCount: roster.length,
    updatedAt: now,
    cronLeaseUntil: 0,
  });
  await root.collection("auditLogs").add({
    schoolId,
    actorUid: "system:cron",
    action: "assignment.published.scheduled",
    recordType: "assignment",
    recordId: doc.id,
    occurredAt: now,
  });
  return true;
}

async function sendReminders(doc: QueryDocumentSnapshot, now: Date) {
  const root = schoolRootOf(doc);
  if (!root) return 0;
  const db = getAdminServices().db;
  const dueAtMs = Date.parse(String(doc.get("deadlineAt")));
  if (!Number.isFinite(dueAtMs)) return 0;
  const overdue = dueAtMs <= now.getTime();
  const flag = overdue ? "overdueNotifiedFor" : "reminderNotifiedFor";
  const deadlineAt = String(doc.get("deadlineAt"));
  if (doc.get(flag) === deadlineAt) return 0; // already handled for this deadline; skip the claim transaction
  // Flags store the deadline they covered, so changing the deadline re-arms reminders.
  const data = await claim(
    doc.ref,
    (current) =>
      current.status === "published" &&
      current.deadlineAt === deadlineAt &&
      current[flag] !== deadlineAt,
  );
  if (!data) return 0;
  const schoolId = root.id;

  const recipients: string[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (
      cursor
        ? doc.ref.collection("recipients").orderBy("__name__").startAfter(cursor)
        : doc.ref.collection("recipients").orderBy("__name__")
    )
      .limit(500)
      .get();
    recipients.push(...page.docs.map((row) => row.id));
    if (page.size < 500) break;
    cursor = page.docs[page.docs.length - 1];
  }
  const submissions = await doc.ref.collection("submissions").select("status").get();
  const done = new Set(
    submissions.docs.filter((row) => SUBMITTED.has(String(row.get("status")))).map((row) => row.id),
  );
  const pending = recipients.filter((id) => !done.has(id));

  const students: Array<{ id: string } & FirebaseFirestore.DocumentData> = [];
  for (let i = 0; i < pending.length; i += 300) {
    const rows = await db.getAll(
      ...pending.slice(i, i + 300).map((id) => root.collection("students").doc(id)),
    );
    for (const row of rows) if (row.exists) students.push({ id: row.id, ...row.data() });
  }
  const targets = await notificationRecipientsForStudents(root, students);
  const entries = students.flatMap((student) => {
    const targetUids = targets.get(student.id) ?? [];
    if (!targetUids.length) return [];
    return [
      {
        id: `${overdue ? "overdue" : "deadline"}_${doc.id}_${student.id}_${deadlineAt.slice(0, 10)}`,
        payload: {
          type: overdue ? "assignment_overdue" : "deadline_approaching",
          title: overdue ? "Assignment overdue" : "Deadline approaching",
          message: `${String(data.title)} is ${overdue ? "overdue" : "due within 24 hours"}.`,
          assignmentId: doc.id,
          studentId: student.id,
          targetUids,
        },
      },
    ];
  });
  await queueNotifications(root, schoolId, entries);
  await doc.ref.update({ [flag]: deadlineAt, cronLeaseUntil: 0 });
  return entries.length;
}

export async function GET(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "Cron authorization required" }, { status: 401 });
  const { db } = getAdminServices();
  const started = Date.now();
  const deadline = started + TIME_BUDGET_MS;
  const now = new Date();
  const nowIso = now.toISOString();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const lookback = new Date(now.getTime() - OVERDUE_LOOKBACK_MS).toISOString();
  let published = 0;
  let reminders = 0;
  let timedOut = false;
  try {
    // Only assignments that are actually due are read (collection-group queries across all schools; no school cap).
    const scheduledQuery = db
      .collectionGroup("assignments")
      .where("status", "==", "scheduled")
      .where("publishAt", "<=", nowIso)
      .orderBy("publishAt", "asc");
    timedOut = await forEachPage(scheduledQuery, deadline, async (docs) => {
      await runPool(docs, async (doc) => {
        if (await publishScheduled(doc, now, nowIso)) published++;
      });
    });
    const reminderQuery = db
      .collectionGroup("assignments")
      .where("status", "==", "published")
      .where("deadlineAt", ">=", lookback)
      .where("deadlineAt", "<=", soon)
      .orderBy("deadlineAt", "asc");
    const reminderTimedOut = await forEachPage(reminderQuery, deadline, async (docs) => {
      await runPool(docs, async (doc) => {
        reminders += await sendReminders(doc, now);
      });
    });
    timedOut = timedOut || reminderTimedOut;
    return NextResponse.json(
      {
        ok: true,
        assignmentsPublished: published,
        remindersQueued: reminders,
        partial: timedOut,
        durationMs: Date.now() - started,
        executedAt: nowIso,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron/assignments] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error: "Assignment cron processing failed",
        assignmentsPublished: published,
        remindersQueued: reminders,
      },
      { status: 500 },
    );
  }
}
