import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getAdminServices } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/server/context";

export type SystemOwner = { uid: string; email: string; displayName: string };

/** Ownership is bound to the Firebase UID provisioned server-side, never to a client-supplied email or role. */
export async function getSystemOwner(): Promise<SystemOwner | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, false);
    if (decoded.email_verified !== true) return null;
    const owner = await db.collection("platformOwners").doc(decoded.uid).get();
    if (!owner.exists || owner.get("status") !== "active") return null;
    const supportToken = (await cookies()).get("edusphere_owner_support")?.value;
    if (supportToken) {
      const support = await db
        .collection("platformSupportSessions")
        .doc(createHash("sha256").update(supportToken).digest("hex"))
        .get();
      const expiresAt = support.get("expiresAt")?.toDate?.();
      if (
        support.exists &&
        support.get("ownerUid") === decoded.uid &&
        support.get("status") === "active" &&
        expiresAt instanceof Date &&
        expiresAt.getTime() > Date.now()
      )
        return null;
    }
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      displayName: decoded.name ?? "System Owner",
    };
  } catch {
    return null;
  }
}
