import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison that is also length-independent (both sides are HMAC'd first). */
export function safeEqual(a: string, b: string): boolean {
  const key = "edusphere-safe-equal";
  const left = createHmac("sha256", key).update(a).digest();
  const right = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(left, right);
}
