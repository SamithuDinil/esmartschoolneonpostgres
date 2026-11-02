import "server-only";
import { createHash } from "node:crypto";
import { getAdminServices } from "@/lib/firebase/admin";

/**
 * Distributed fixed-window rate limiter.
 *
 * Serverless instances do not share memory, so counters live in a shared store:
 *  1. Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set.
 *  2. Otherwise Firestore (`rateLimits/{sha256(key)}`), written via Admin SDK only
 *     (client access is denied by firestore.rules). Add a Firestore TTL policy on `expiresAt`.
 *  3. If the shared store is unreachable, fall back to a per-instance Map so a backend outage
 *     degrades protection instead of locking everyone out.
 */
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfter: number };

const buckets = new Map<string, { count: number; resetAt: number }>();

export function requestIp(request: Request) {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function consumeLocal(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 10_000)
    for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfter: Math.ceil(windowMs / 1000),
    };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfter: Math.ceil((existing.resetAt - now) / 1000),
  };
}

async function consumeUpstash(
  url: string,
  token: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  const response = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(windowMs), "NX"],
      ["PTTL", redisKey],
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`Upstash ${response.status}`);
  const rows = (await response.json()) as Array<{ result?: number; error?: string }>;
  const count = Number(rows[0]?.result);
  const ttl = Number(rows[2]?.result);
  if (!Number.isFinite(count) || rows[0]?.error) throw new Error("Upstash bad response");
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)),
  };
}

async function consumeFirestore(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { db } = getAdminServices();
  const ref = db.collection("rateLimits").doc(createHash("sha256").update(key).digest("hex"));
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const snap = await tx.get(ref);
    const resetAt = Number(snap.get("resetAt") ?? 0);
    if (!snap.exists || resetAt <= now) {
      tx.set(ref, {
        count: 1,
        resetAt: now + windowMs,
        expiresAt: new Date(now + windowMs + 60 * 60 * 1000),
      });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfter: Math.ceil(windowMs / 1000),
      };
    }
    const count = Number(snap.get("count") ?? 0) + 1;
    tx.update(ref, { count });
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  });
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const shared = url && token
      ? consumeUpstash(url, token, key, limit, windowMs)
      : consumeFirestore(key, limit, windowMs);
    // Never let a slow shared store hang auth longer than a few seconds.
    return await Promise.race([
      shared,
      new Promise<RateLimitResult>((_, reject) =>
        setTimeout(() => reject(new Error("rate-limit timeout")), 3_000),
      ),
    ]);
  } catch (error) {
    console.error(
      "[rate-limit] shared store unavailable, using per-instance fallback:",
      error instanceof Error ? error.message : error,
    );
    return consumeLocal(key, limit, windowMs);
  }
}

export function rateLimitResponse(retryAfter: number) {
  return new Response(JSON.stringify({ error: "Too many attempts. Please wait and try again." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "Cache-Control": "no-store",
    },
  });
}
