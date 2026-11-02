import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";
import { consumeRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { getCachedAiSnapshot, optionalModelAnswer } from "@/server/services/ai";
import { deterministicAnswer } from "@/server/services/ai-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const questionSchema = z.object({ question: z.string().trim().min(3).max(500) });

function denied(message = "AI assistant access is restricted to authorized school staff.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function GET() {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "ai.assistant")) return denied();
  const config = await getAdminServices()
    .db.collection("schools")
    .doc(context.schoolId)
    .collection("settings")
    .doc("system")
    .get();
  return NextResponse.json(
    {
      enabled: config.get("ai.enabled") === true,
      modelExplanation: config.get("ai.allowModelExplanation") === true,
      questions: [
        "How many students were absent today?",
        "Which classes have low attendance?",
        "What is the average examination performance?",
        "Which invoices are overdue?",
        "What events are scheduled this week?",
      ],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context || !hasPermission(context.permissions, "ai.assistant")) return denied();
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token." }, { status: 403 });
  const [perMinute, perHour, perSchool] = await Promise.all([
    consumeRateLimit(`ai-user-min:${context.schoolId}:${context.uid}`, 5, 60 * 1000),
    consumeRateLimit(`ai-user-hour:${context.schoolId}:${context.uid}`, 60, 60 * 60 * 1000),
    consumeRateLimit(`ai-school-hour:${context.schoolId}`, 300, 60 * 60 * 1000),
  ]);
  const blocked = [perMinute, perHour, perSchool].find((rate) => !rate.allowed);
  if (blocked) return rateLimitResponse(blocked.retryAfter);
  const parsed = questionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Ask a question about the authorized school records." },
      { status: 400 },
    );
  try {
    const root = getAdminServices().db.collection("schools").doc(context.schoolId);
    const [config, school] = await Promise.all([
      root.collection("settings").doc("system").get(),
      root.get(),
    ]);
    const enabled = config.get("ai.enabled") === true;
    if (!enabled)
      return NextResponse.json({
        enabled: false,
        status: "disabled",
        answer:
          "AI assistant is disabled for this school. The rest of E-SmartSchool.lk remains fully available; an authorized administrator can enable aggregate-only summaries in System settings.",
      });
    const { snapshot } = await getCachedAiSnapshot(context);
    const currency = String(school.get("currency") ?? "LKR");
    const fallback = deterministicAnswer(parsed.data.question, snapshot, currency);
    let answer = fallback;
    let aiUsed = false;
    if (config.get("ai.allowModelExplanation") === true) {
      const modelAnswer = await optionalModelAnswer(parsed.data.question, snapshot, currency).catch(
        () => null,
      );
      if (modelAnswer) {
        answer = modelAnswer;
        aiUsed = true;
      }
    }
    await root.collection("auditLogs").add({
      schoolId: context.schoolId,
      actorUid: context.uid,
      action: "ai.assistant.queried",
      recordType: "aiQuery",
      questionCategory: parsed.data.question.toLowerCase().includes("attendance")
        ? "attendance"
        : parsed.data.question.toLowerCase().includes("invoice")
          ? "finance"
          : parsed.data.question.toLowerCase().includes("event")
            ? "events"
            : parsed.data.question.toLowerCase().includes("exam") ||
                parsed.data.question.toLowerCase().includes("performance")
              ? "academic"
              : "navigation",
      modelUsed: aiUsed,
      occurredAt: new Date(),
    });
    return NextResponse.json({
      enabled: true,
      status: aiUsed ? "model_explained" : "deterministic_summary",
      answer,
      aiUsed,
      sources: ["authorized school aggregates", "no student-level identifiers sent"],
      snapshot,
    });
  } catch {
    return NextResponse.json(
      { error: "The authorized school summary could not be prepared." },
      { status: 500 },
    );
  }
}
