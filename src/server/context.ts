import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getAdminServices } from "@/lib/firebase/admin";
import { permissionsForRole, type Role } from "@/server/permissions";

export const SESSION_COOKIE = "webdev_app_session";
export type SchoolContext = {
  uid: string;
  schoolId: string;
  role: string;
  permissions: string[];
  displayName: string;
  supportMode?: { reason: string; expiresAt: string; ownerUid: string };
};

export async function getSessionUid(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const decoded = await getAdminServices().auth.verifySessionCookie(token, false);
    return decoded.uid;
  } catch {
    return null;
  }
}

async function resolveSchoolContext(
  token: string,
  supportToken: string | undefined,
): Promise<SchoolContext | null> {
  try {
    const { auth, db } = getAdminServices();
    const decoded = await auth.verifySessionCookie(token, false);
    if (supportToken && decoded.email_verified === true) {
      const owner = await db.collection("platformOwners").doc(decoded.uid).get();
      const supportRef = db
        .collection("platformSupportSessions")
        .doc(createHash("sha256").update(supportToken).digest("hex"));
      const support = await supportRef.get();
      const expiresAt = support.get("expiresAt")?.toDate?.();
      const schoolId = String(support.get("schoolId") ?? "");
      if (
        owner.exists &&
        owner.get("status") === "active" &&
        support.exists &&
        support.get("ownerUid") === decoded.uid &&
        support.get("status") === "active" &&
        expiresAt instanceof Date &&
        expiresAt.getTime() > Date.now()
      ) {
        const school = await db.collection("schools").doc(schoolId).get();
        if (
          school.exists &&
          school.get("status") === "active" &&
          school.get("emergencyLock")?.status !== "active" &&
          school.get("deletion")?.status !== "pending"
        ) {
          return {
            uid: decoded.uid,
            schoolId,
            role: "school_owner",
            permissions: permissionsForRole("school_owner").filter(
              (permission) => permission !== "school.ownership.transfer",
            ),
            displayName: decoded.name ?? "System Owner",
            supportMode: {
              reason: String(support.get("reason") ?? ""),
              expiresAt: expiresAt.toISOString(),
              ownerUid: decoded.uid,
            },
          };
        }
      }
    }
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) return null;
    const user = userSnap.data();
    if (user?.status === "suspended" || user?.status === "disabled") return null;
    const schoolId = typeof user?.activeSchoolId === "string" ? user.activeSchoolId : null;
    if (!schoolId) return null;

    const membershipSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("memberships")
      .doc(decoded.uid)
      .get();
    if (!membershipSnap.exists) return null;
    const schoolSnap = await db.collection("schools").doc(schoolId).get();
    const schoolStatus = schoolSnap.data()?.status;
    if (
      !schoolSnap.exists ||
      ["setup_pending", "suspended", "archived", "deletion_pending"].includes(
        String(schoolStatus ?? ""),
      )
    )
      return null;
    const membership = membershipSnap.data();
    if (membership?.status !== "active") return null;
    const role = typeof membership.role === "string" ? membership.role : "staff";
    const savedPermissions = Array.isArray(membership.permissions)
      ? membership.permissions.filter((item): item is string => typeof item === "string")
      : [];
    const rolePermissionDoc = role === "school_owner"
      ? null
      : await db.collection("schools").doc(schoolId).collection("rolePermissions").doc(role).get();
    const roleOverride = rolePermissionDoc?.get("permissions");
    const supportedRole = [
      "school_owner",
      "school_admin",
      "principal",
      "vice_principal",
      "section_head",
      "teacher",
      "class_teacher",
      "subject_teacher",
      "student",
      "parent",
      "accountant",
      "librarian",
      "transport_manager",
      "administrative_staff",
      "staff",
    ].includes(role);
    // School owners always receive the complete owner matrix. Older memberships may predate
    // persisted permissions; use the role matrix in that case while retaining custom grants for
    // other roles configured by an administrator.
    const permissions =
      role === "school_owner"
        ? Array.from(new Set([...permissionsForRole("school_owner"), ...savedPermissions]))
        : Array.isArray(roleOverride)
          ? roleOverride.filter((item): item is string => typeof item === "string")
          : membership.permissionsCustomized === true
            ? savedPermissions
            : savedPermissions.length > 0 || !supportedRole
              ? savedPermissions
              : [...permissionsForRole(role as Role)];

    return {
      uid: decoded.uid,
      schoolId,
      role,
      permissions,
      displayName:
        typeof user?.displayName === "string" ? user.displayName : (decoded.name ?? "School user"),
    };
  } catch {
    return null;
  }
}

/**
 * Short-lived per-instance cache. Resolving a context costs a revocation-checked session verify plus
 * 3-4 Firestore reads, and a page typically fires several API calls at once. Entries live for
 * CONTEXT_TTL_MS, so a role change, suspension or session revocation can take up to that long to
 * take effect on an instance that already cached the old result; logout clears the entry immediately
 * on the instance that handled it. Keep the TTL short.
 */
const CONTEXT_TTL_MS = 10_000;
const CONTEXT_CACHE_MAX = 500;
const contextCache = new Map<string, { expires: number; value: SchoolContext | null }>();
const inflight = new Map<string, Promise<SchoolContext | null>>();

function cacheKey(token: string, supportToken: string | undefined) {
  return createHash("sha256")
    .update(`${token}\u0000${supportToken ?? ""}`)
    .digest("hex");
}

export function clearSchoolContextCache() {
  contextCache.clear();
  inflight.clear();
}

export async function getSchoolContext(): Promise<SchoolContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const supportToken = jar.get("edusphere_owner_support")?.value;
  const key = cacheKey(token, supportToken);
  const now = Date.now();

  const hit = contextCache.get(key);
  if (hit && hit.expires > now) return hit.value;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = resolveSchoolContext(token, supportToken)
    .then((value) => {
      if (contextCache.size >= CONTEXT_CACHE_MAX) {
        for (const [k, entry] of contextCache)
          if (entry.expires <= Date.now()) contextCache.delete(k);
        if (contextCache.size >= CONTEXT_CACHE_MAX)
          contextCache.delete(contextCache.keys().next().value as string);
      }
      // Only successful resolutions are cached; null (bad/expired session) is re-checked next time.
      if (value) contextCache.set(key, { expires: Date.now() + CONTEXT_TTL_MS, value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
