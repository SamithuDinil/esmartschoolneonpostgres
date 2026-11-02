import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/server/context";
import { cookieOptions } from "@/server/cookies";
import { CSRF_COOKIE, hasValidCsrf } from "@/server/csrf";
import { consumeRateLimit, rateLimitResponse, requestIp } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const bodySchema = z
  .object({
    idToken: z.string().min(20).max(10_000).optional(),
    username: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .optional(),
    password: z.string().min(1).max(1024).optional(),
    remember: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.idToken) !== Boolean(value.username && value.password));

const INVALID_LOGIN = "Invalid sign-in details.";
const SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const REMEMBER_TTL_MS = 13 * 24 * 60 * 60 * 1000; // under Firebase 2-week max (exclusive edge cases)
const SYSTEM_OWNER_EMAILS = new Set([
  "samithudinildewapriya@gmail.com",
  "sasindagimhana10@gmail.com",
]);

/**
 * Username sign-in happens entirely on the server: the username is resolved to an email and the
 * password is verified against Firebase Auth here, so the email address is never sent to the browser.
 */
async function idTokenForUsername(username: string, password: string): Promise<string | null> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) return null;
  try {
    const { db } = getAdminServices();
    const result = await db
      .collection("users")
      .where("usernameNormalized", "==", username.toLowerCase())
      .limit(1)
      .get();
    const email = result.empty ? null : result.docs[0].get("email");
    if (typeof email !== "string" || !email) return null;
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { idToken?: string } | null;
    return typeof body?.idToken === "string" ? body.idToken : null;
  } catch {
    return null;
  }
}

async function recordLoginSideEffects(
  uid: string,
  decoded: {
    email?: string;
    email_verified?: boolean;
    firebase?: { sign_in_provider?: string };
  },
  request: NextRequest,
) {
  try {
    const { db } = getAdminServices();
    const verifiedEmail = decoded.email?.trim().toLowerCase();
    if (
      decoded.email_verified === true &&
      verifiedEmail &&
      SYSTEM_OWNER_EMAILS.has(verifiedEmail)
    ) {
      const ownerRef = db.collection("platformOwners").doc(uid);
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(ownerRef);
        if (existing.exists && existing.get("status") === "active") return;
        tx.set(ownerRef, {
          uid,
          email: verifiedEmail,
          role: "SYSTEM_OWNER",
          status: "active",
          provisionedAt: new Date(),
          provisionedBy: "verified-email-login",
        });
      });
    }

    const activity = db.collection("users").doc(uid).collection("loginActivity");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await activity.add({
      occurredAt: new Date(),
      ip,
      userAgent: request.headers.get("user-agent") ?? "unknown",
      provider: decoded.firebase?.sign_in_provider ?? "password",
    });
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          lastActivityAt: new Date(),
          lastSignInProvider: decoded.firebase?.sign_in_provider ?? "password",
        },
        { merge: true },
      );
  } catch (error) {
    console.error(
      "[auth/session] non-critical login side effects failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const rate = await consumeRateLimit(`auth-session:${requestIp(request)}`, 12, 15 * 60 * 1000);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  } catch (error) {
    console.error(
      "[auth/session] rate limit failed open:",
      error instanceof Error ? error.message : error,
    );
  }

  if (!hasValidCsrf(request)) {
    return NextResponse.json(
      { error: "This secure sign-in request expired. Please retry." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400 });

  let idToken = parsed.data.idToken;
  if (!idToken) {
    const username = parsed.data.username!.toLowerCase();
    try {
      const perUser = await consumeRateLimit(`auth-session-user:${username}`, 10, 15 * 60 * 1000);
      if (!perUser.allowed) return rateLimitResponse(perUser.retryAfter);
    } catch {
      /* fail open */
    }
    idToken = (await idTokenForUsername(username, parsed.data.password!)) ?? undefined;
    if (!idToken) return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
  }

  let auth: ReturnType<typeof getAdminServices>["auth"];
  try {
    auth = getAdminServices().auth;
  } catch (error) {
    console.error(
      "[auth/session] admin setup failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error:
          "Server sign-in is not configured. Ask the administrator to set the Firebase service account (FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON).",
      },
      { status: 500 },
    );
  }

  try {
    const decoded = await auth.verifyIdToken(idToken, false);
    if (!decoded.email_verified) {
      return NextResponse.json(
        { error: "Please verify your email and sign in again." },
        { status: 401 },
      );
    }
    // Firebase createSessionCookie requires the ID token to be less than 5 minutes old.
    if (!decoded.auth_time || Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json(
        { error: "Please sign in again to refresh your session." },
        { status: 401 },
      );
    }

    const requested = parsed.data.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    // Firebase requires expiresIn in [5 minutes, 14 days]
    const ttl = Math.min(Math.max(requested, 5 * 60 * 1000), 13 * 24 * 60 * 60 * 1000);
    const session = await auth.createSessionCookie(idToken, { expiresIn: ttl });

    // Best-effort side effects; never block issuing the session cookie.
    await Promise.race([
      recordLoginSideEffects(decoded.uid, decoded, request),
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);

    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SESSION_COOKIE, session, cookieOptions(Math.floor(ttl / 1000)));
    response.cookies.set(CSRF_COOKIE, "", cookieOptions(0));
    return response;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auth/session] token verification failed:", code, message);

    let userMessage = "Sign-in could not be verified. Check your account and try again.";
    if (
      /incorrect "?aud"?|audience|project.?id.?mismatch|does not match/i.test(message) ||
      code === "auth/argument-error"
    ) {
      userMessage =
        "Firebase project mismatch: the web app config and the service account are not for the same project. Set matching NEXT_PUBLIC_FIREBASE_* and FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON in Vercel, then redeploy.";
    } else if (code === "auth/id-token-expired" || /id-token-expired/i.test(message)) {
      userMessage = "Your sign-in token expired. Please try again.";
    } else if (code === "auth/id-token-revoked" || /revoked/i.test(message)) {
      userMessage = "This session was revoked. Sign in again.";
    } else if (code === "auth/user-disabled") {
      userMessage = "This account has been disabled.";
    } else if (/session cookie|expiresIn|expires.?in/i.test(message)) {
      userMessage = "Session could not be created. Please try again without 'Remember me', or contact support.";
    } else if (/credential|private.?key|DECODER|PEM|invalid.?jwt/i.test(message)) {
      userMessage =
        "Server Firebase credentials look invalid. Re-paste FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON in Vercel (full JSON, with real newlines in private_key).";
    }

    return NextResponse.json({ error: userMessage, code: code || undefined }, { status: 401 });
  }
}
