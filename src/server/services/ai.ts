import "server-only";
import { getAdminServices } from "@/lib/firebase/admin";
import type { SchoolContext } from "@/server/context";
import type { AiSnapshot } from "@/server/services/ai-core";

type AnyRecord = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" ? value : "";
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function weekEnd() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}
function record(doc: FirebaseFirestore.DocumentSnapshot): AnyRecord {
  return { id: doc.id, ...(doc.data() ?? {}) };
}

export async function buildAiSnapshot(context: SchoolContext): Promise<AiSnapshot> {
  const root = getAdminServices().db.collection("schools").doc(context.schoolId);
  const date = today();
  const [
    attendanceSnap,
    examsSnap,
    invoicesSnap,
    eventsSnap,
    studentsSnap,
    teachersSnap,
    inventorySnap,
    documentsSnap,
  ] = await Promise.all([
    root
      .collection("attendanceSessions")
      .where("date", "==", date)
      .limit(500)
      .get()
      .catch(() => root.collection("attendanceSessions").limit(500).get()),
    root
      .collection("exams")
      .where("status", "==", "published")
      .limit(120)
      .get()
      .catch(() => root.collection("exams").limit(120).get()),
    root.collection("invoices").limit(1000).get(),
    root.collection("events").limit(500).get(),
    root.collection("students").limit(1500).get(),
    root.collection("teachers").limit(500).get(),
    root.collection("inventoryItems").limit(1000).get(),
    root.collection("documents").limit(1000).get(),
  ]);

  const attendanceRows = attendanceSnap.docs.filter(
    (doc) => String(doc.get("date") ?? "") === date,
  );
  const attendanceTotals = attendanceRows.reduce(
    (sum, row) => ({
      sessions: sum.sessions + 1,
      absent: sum.absent + Number(row.get("absent") ?? 0),
      present: sum.present + Number(row.get("present") ?? 0),
      late: sum.late + Number(row.get("late") ?? 0),
      excused: sum.excused + Number(row.get("excused") ?? 0),
    }),
    { sessions: 0, absent: 0, present: 0, late: 0, excused: 0 },
  );
  const denominator = attendanceTotals.present + attendanceTotals.absent + attendanceTotals.late;
  const groupMap = new Map<string, { total: number; count: number }>();
  for (const row of attendanceRows) {
    const label = `${String(row.get("grade") ?? "Grade")} · ${String(row.get("className") ?? "Class")}`;
    const percentage = Number(row.get("attendancePercentage"));
    if (!Number.isFinite(percentage)) continue;
    const current = groupMap.get(label) ?? { total: 0, count: 0 };
    groupMap.set(label, { total: current.total + percentage, count: current.count + 1 });
  }
  const lowAttendance = [...groupMap.entries()]
    .map(([label, value]) => ({
      label,
      percentage: round(value.total / value.count),
      sessions: value.count,
    }))
    .filter((row) => row.percentage < 80)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 10);

  let marks = 0;
  let markTotal = 0;
  for (const exam of examsSnap.docs.slice(0, 80)) {
    const markSnap = await exam.ref
      .collection("marks")
      .limit(2000)
      .get()
      .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
    for (const mark of markSnap.docs) {
      const value = Number(mark.get("marks"));
      if (Number.isFinite(value)) {
        marks += 1;
        markTotal += value;
      }
    }
  }
  const overdue = invoicesSnap.docs.reduce(
    (sum, doc) => {
      const balance = Number(doc.get("balance") ?? 0);
      const dueDate = String(doc.get("dueDate") ?? "");
      if (balance > 0 && dueDate && dueDate < date)
        return { count: sum.count + 1, balance: sum.balance + balance };
      return sum;
    },
    { count: 0, balance: 0 },
  );
  const eventsThisWeek = eventsSnap.docs
    .map(record)
    .filter((event) => {
      const start = iso(event.startAt);
      return (
        event.status === "published" && start >= new Date().toISOString() && start <= weekEnd()
      );
    })
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, 12)
    .map((event) => ({
      title: String(event.title ?? event.name ?? "School event"),
      startAt: iso(event.startAt),
      category: String(event.category ?? "event"),
    }));
  return {
    attendanceToday: {
      ...attendanceTotals,
      percentage: denominator
        ? round(((attendanceTotals.present + attendanceTotals.late) / denominator) * 100)
        : 0,
    },
    lowAttendance,
    examination: {
      publishedExams: examsSnap.docs.filter((doc) => doc.get("status") === "published").length,
      marks,
      average: marks ? round(markTotal / marks) : 0,
    },
    overdueInvoices: { count: overdue.count, balance: round(overdue.balance) },
    eventsThisWeek,
    administration: {
      activeStudents: studentsSnap.docs.filter((doc) => doc.get("status") !== "archived").length,
      teachers: teachersSnap.size,
      inventoryAssets: inventorySnap.size,
      documents: documentsSnap.size,
    },
  };
}

export async function optionalModelAnswer(
  question: string,
  snapshot: AiSnapshot,
  currency: string,
) {
  const base = process.env.AI_API_URL;
  const key = process.env.AI_API_KEY;
  if (!base || !key) return null;
  const redactedContext = JSON.stringify({ question, currency, snapshot });
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "gpt-5-mini",
      max_completion_tokens: 450,
      messages: [
        {
          role: "system",
          content:
            "You are an optional school assistant. Use only the aggregate, redacted school context in the user message. Never invent values, names, student identifiers, or records. Say when the data is empty or insufficient. Do not make changes. Keep the answer concise and mention the source area.",
        },
        { role: "user", content: redactedContext },
      ],
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;
  const content = body?.choices?.[0]?.message?.content?.trim();
  return content || null;
}

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

/**
 * Returns the school's aggregate snapshot, rebuilding it at most once per 10 minutes.
 * The cache is a single Firestore document, so it is shared by every serverless instance:
 * a cache hit costs 1 read instead of ~160k.
 */
export async function getCachedAiSnapshot(
  context: SchoolContext,
): Promise<{ snapshot: AiSnapshot; generatedAt: string; cached: boolean }> {
  const cacheRef = getAdminServices()
    .db.collection("schools")
    .doc(context.schoolId)
    .collection("aiCache")
    .doc("snapshot");
  const cachedDoc = await cacheRef.get().catch(() => null);
  const generatedAtMs = Number(cachedDoc?.get("generatedAtMs") ?? 0);
  const cachedSnapshot = cachedDoc?.get("snapshotJson");
  if (
    typeof cachedSnapshot === "string" &&
    cachedDoc?.get("date") === today() &&
    Date.now() - generatedAtMs < SNAPSHOT_TTL_MS
  ) {
    try {
      return {
        snapshot: JSON.parse(cachedSnapshot) as AiSnapshot,
        generatedAt: new Date(generatedAtMs).toISOString(),
        cached: true,
      };
    } catch {
      /* rebuild below */
    }
  }
  const snapshot = await buildAiSnapshot(context);
  const now = Date.now();
  await cacheRef
    .set({
      snapshotJson: JSON.stringify(snapshot),
      generatedAtMs: now,
      date: today(),
      schoolId: context.schoolId,
    })
    .catch(() => undefined);
  return { snapshot, generatedAt: new Date(now).toISOString(), cached: false };
}
