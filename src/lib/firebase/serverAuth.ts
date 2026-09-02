import { adminAuth, adminDb } from "./server";
import { isUserRole, type UserRole } from "@/lib/constants/hierarchy";

export interface DecodedAuth {
  uid: string;
  role: UserRole;
  email?: string;
  name?: string;
  /**
   * For a sub admin, their own uid; for an employee, the sub admin who manages
   * them. Absent means the admin manages them directly. Read once here so the
   * actions do not each re-fetch the profile to answer "whose team is this".
   */
  subAdminUid?: string | null;
}

/**
 * Thrown for every authentication/authorization failure. Never leaks whether a
 * uid exists — callers surface the message straight to the user.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Verifies a Firebase ID token and resolves the caller's CRM role.
 *
 * Role comes from the `role` custom claim (set only by the Admin SDK). The
 * `users/{uid}` document is a fallback for accounts created before claims were
 * issued — Security Rules make that document admin-writable only, so it is not
 * a self-service escalation path.
 *
 * **Verification is local.** `verifyIdToken(token)` checks the signature against
 * cached Google public keys with no network call. Passing `checkRevoked: true`
 * — as this used to — turns every single Server Action into an extra round trip
 * to the Auth backend before any work starts, and makes that round trip the
 * first thing that must resolve Admin SDK credentials. On a slow link it was
 * the dominant cost of every write in the app.
 *
 * FR-3 (a disabled employee is blocked immediately) is still met, by the check
 * below rather than by the network: `disableEmployee` writes
 * `status: 'DISABLED'` onto `users/{uid}`, and this function reads that document
 * on every call anyway. The rejection therefore happens on the very next
 * request, exactly as before — and `disableEmployee` also calls
 * `updateUser({disabled:true})` and `revokeRefreshTokens`, so the account cannot
 * mint a fresh token either. `checkRevoked` was a third belt on the same braces.
 */
export async function verifyAuth(token: string): Promise<DecodedAuth> {
  if (!token) {
    throw new AuthError("Not signed in.");
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    throw new AuthError("Your session is invalid or has expired. Please sign in again.");
  }

  const snap = await adminDb.collection("users").doc(decoded.uid).get();
  if (!snap.exists) {
    throw new AuthError("This account has no CRM profile. Ask an administrator to add you.");
  }

  const profile = snap.data() ?? {};
  if (profile.status === "DISABLED") {
    throw new AuthError("This account has been disabled.");
  }

  // The claim is authoritative, but the profile document is the fallback for
  // an account whose claim has not been re-issued yet — a sub admin promoted
  // from an employee still holds an `employee` claim until they sign in again,
  // and locking them out of their own new screens until then would look like a
  // bug. The profile is admin-writable only, so this is not an escalation path.
  const claimed = decoded.role as string | undefined;
  const role = isUserRole(claimed) ? claimed : profile.role;
  if (!isUserRole(role)) {
    throw new AuthError("This account has no role assigned. Ask an administrator to set one.");
  }

  return {
    uid: decoded.uid,
    role,
    email: decoded.email ?? profile.email,
    name: profile.name,
    subAdminUid: role === "subadmin" ? decoded.uid : (profile.subAdminUid ?? null),
  };
}

/** Verifies the caller and rejects anyone who is not an admin. */
export async function requireAdmin(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (auth.role !== "admin") {
    throw new AuthError("Only an administrator can do this.");
  }
  return auth;
}

/**
 * Admin **or** sub admin — the two roles that manage people and hand out leads.
 *
 * On its own this only says "you manage somebody". Every caller still has to
 * check *which* somebody with `assertManagesEmployee` / `assertManagesFolder`
 * below, because a sub admin passing this test is not thereby entitled to touch
 * another sub admin's team.
 */
export async function requireManager(token: string): Promise<DecodedAuth> {
  const auth = await verifyAuth(token);
  if (auth.role !== "admin" && auth.role !== "subadmin") {
    throw new AuthError("Only an administrator or sub admin can do this.");
  }
  return auth;
}

/**
 * Throws unless `auth` is entitled to act on this employee.
 *
 * The link is stored on the employee (`users/{uid}.subAdminUid`), so this is a
 * single document read and cannot disagree with what the Security Rules see.
 * An admin passes for everyone; a sub admin passes only for their own team.
 */
export async function assertManagesEmployee(
  auth: DecodedAuth,
  employeeUid: string
): Promise<Record<string, unknown>> {
  const snap = await adminDb.collection("users").doc(employeeUid).get();
  if (!snap.exists) {
    throw new AuthError("That team member no longer exists.");
  }

  const profile = snap.data() ?? {};
  if (auth.role === "admin") return profile;

  if (auth.role !== "subadmin" || profile.subAdminUid !== auth.uid) {
    throw new AuthError("That team member is not on your team.");
  }
  return profile;
}

/** The same test for a Data Bank folder, which carries its own `subAdminUid`. */
export async function assertManagesFolder(
  auth: DecodedAuth,
  folderId: string
): Promise<Record<string, unknown>> {
  const snap = await adminDb.collection("dataBankFolders").doc(folderId).get();
  if (!snap.exists) {
    throw new AuthError("That folder no longer exists.");
  }

  const folder = snap.data() ?? {};
  if (auth.role === "admin") return folder;

  if (auth.role !== "subadmin" || folder.subAdminUid !== auth.uid) {
    throw new AuthError("That folder has not been assigned to you.");
  }
  return folder;
}
