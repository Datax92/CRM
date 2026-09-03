"use server";

import { adminDb, adminAuth } from "@/lib/firebase/server";
import { requireAdmin, requireManager } from "@/lib/firebase/serverAuth";
import { MIN_PRIORITY, MAX_PRIORITY } from "@/lib/constants/distribution";
import { normalizeJobTitle } from "@/lib/constants/roles";
import { normalizeManagerKind, type ManagerKind, type UserRole } from "@/lib/constants/hierarchy";
import type { KpiTargets } from "@/lib/kpi";
import {
  normalizeTargets,
  recalculatePriorities,
  type PriorityChange,
} from "@/lib/server/recalcPriorities";
import { runAction, UserFacingError, type ActionResult } from "@/lib/actionResult";
import { FieldValue } from "firebase-admin/firestore";

export type { PriorityChange };

export interface CreateEmployeeInput {
  name: string;
  email: string;
  password: string;
  priority: number;
  /**
   * `employee` (default) or `subadmin`.
   *
   * One account-creation path, two very different records. A **manager is not
   * an employee**: they are not in the distribution lane, they take no leads,
   * and their KPI is the sum of their team's rather than a target of their own.
   * The document written below reflects that — see the `isManager` branches —
   * but the Auth account, the rollback and the email/password rules are
   * identical, and duplicating those is how two creation paths drift apart.
   *
   * The *forms* are separate (Add Employee vs Add Manager), which is what the
   * owner asked for and what actually matters: nobody is offered a lane
   * priority for somebody who will never be in the lane.
   */
  accessRole?: "employee" | "subadmin";
  /** The sub admin who manages this person. Absent means the admin directly. */
  subAdminUid?: string | null;
  /** Human job title shown in the directory. Not an access role. */
  jobTitle?: string;
  /** Employees can be created paused so they sit out the rotation until ready. */
  status?: "ACTIVE" | "DISABLED";
  /** Monthly KPI targets. Falls back to the company defaults when omitted. */
  targets?: Partial<KpiTargets>;
  /** Directory fields — all optional, none of them gate anything. */
  phone?: string | null;
  notes?: string | null;
  /** ISO date. The day they started, which is not the day the record was made. */
  joinedAt?: string | null;
  /** `false` takes them out of automatic distribution. See `lib/distribution`. */
  autoAssign?: boolean;
  /**
   * Which kind of manager (§13). `SALES` runs a team's pipeline; `HR` runs
   * attendance and leave for the whole company. Meaningless on an employee
   * record, so it is written only when `accessRole` is `subadmin`.
   */
  managerKind?: ManagerKind;
  /**
   * Monthly salary, used as the base for a percentage late deduction (§5) and
   * for the payroll figures in the Money hub (§12). Zero means "not recorded",
   * and a percentage rule then charges nothing rather than guessing.
   */
  monthlySalary?: number;
}

/**
 * Creates an employee account (FR-1, BR-1).
 *
 * The Auth user and the profile document are created together; if the profile
 * write fails the Auth user is removed again, so a half-created employee who
 * can sign in but has no role never exists.
 */
export async function createEmployee(
  token: string,
  input: CreateEmployeeInput
): Promise<ActionResult<{ uid: string }>> {
  return runAction("createEmployee", async () => {
    console.log("SERVER ACTION STARTED: createEmployee");
    let admin;
    try {
      admin = await requireAdmin(token);
      console.log("Admin verified:", admin.uid);
    } catch (e) {
      console.error("requireAdmin threw an error:", e);
      throw e;
    }

    const name = (input.name ?? "").trim();
    const email = (input.email ?? "").trim().toLowerCase();
    const password = input.password ?? "";
    const accessRole: UserRole = input.accessRole === "subadmin" ? "subadmin" : "employee";
    const isManager = accessRole === "subadmin";
    // A manager has no place in the lane, so they get no priority to be ranked
    // by and no monthly targets to be measured against. Writing either would
    // put them in `recalculatePriorities`' ordering and on the KPI dashboard as
    // a person with 0 connects — which is true and completely meaningless.
    const priority = isManager ? MAX_PRIORITY : normalizePriority(input.priority);
    const subAdminUid = await resolveSubAdminUid(input.subAdminUid, accessRole);
    const jobTitle = normalizeJobTitle(input.jobTitle);
    const status = input.status === "DISABLED" ? "DISABLED" : "ACTIVE";
    const targets = normalizeTargets(input.targets);
    const { phone, notes, joinedAt, autoAssign } = normalizeDirectoryFields(input);
    const monthlySalary = Math.max(0, Math.round(Number(input.monthlySalary) || 0));
    const managerKind = normalizeManagerKind(input.managerKind);

    if (!name) {
      throw new UserFacingError("Enter the employee's name.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserFacingError("Enter a valid email address.");
    }
    if (password.length < 8) {
      throw new UserFacingError("The password must be at least 8 characters.");
    }

    let userRecord;
    try {
      userRecord = await adminAuth.createUser({ email, password, displayName: name });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === "auth/email-already-exists") {
        throw new UserFacingError("An account with that email already exists.");
      }
      if (code === "auth/invalid-password") {
        throw new UserFacingError("That password is not strong enough.");
      }
      throw error;
    }

    try {
      // The manager kind rides in the token rather than being read from the
      // profile on every page load: the sidebar has to know whether this is an
      // HR manager before it can draw itself, and a document read for that
      // would be one round trip on every navigation. An older manager account
      // with no claim falls back to SALES, which grants nothing.
      await adminAuth.setCustomUserClaims(userRecord.uid, {
        role: accessRole,
        ...(isManager ? { managerKind } : {}),
      });

      await adminDb.collection("users").doc(userRecord.uid).create({
        name,
        email,
        role: accessRole,
        jobTitle,
        // Written only when there is one, so "managed directly by the admin"
        // stays the absence of a field rather than a magic string.
        ...(subAdminUid ? { subAdminUid } : {}),
        priority,
        status,
        phone,
        notes,
        joinedAt,
        // Everything below belongs to the distribution lane and the KPI
        // module, neither of which a manager takes part in.
        monthlySalary,
        ...(isManager
          ? { autoAssign: false, autoPriority: false, managerKind }
          : {
              targets,
              // Absent means "in the lane" everywhere else, so only write the
              // field when the admin actually chose manual-only.
              ...(autoAssign === false ? { autoAssign: false } : {}),
              // New joiners start on automatic priority; an admin pins them by
              // setting a priority by hand, which clears this flag.
              autoPriority: true,
            }),
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: admin.uid,
      });
    } catch (error) {
      // Roll back so we never leave an account that can sign in but has no profile.
      await adminAuth.deleteUser(userRecord.uid).catch(() => {});
      throw error;
    }

    return { uid: userRecord.uid };
  });
}

/** Changes an employee's rotation priority (FR-1, BR-2). */
export async function setEmployeePriority(
  token: string,
  uid: string,
  priority: number
): Promise<ActionResult> {
  return runAction("setEmployeePriority", async () => {
    await requireAdmin(token);
    const next = normalizePriority(priority);

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists || snap.data()?.role !== "employee") {
      throw new UserFacingError("That employee no longer exists.");
    }

    // Setting a priority by hand pins it. Otherwise the next KPI
    // recalculation would silently undo what the admin just did.
    await userRef.update({ priority: next, autoPriority: false });
  });
}

/** Puts an employee's lane priority back under KPI control (FR-1, BR-2). */
export async function setEmployeeAutoPriority(
  token: string,
  uid: string,
  auto: boolean
): Promise<ActionResult> {
  return runAction("setEmployeeAutoPriority", async () => {
    await requireAdmin(token);

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists || snap.data()?.role !== "employee") {
      throw new UserFacingError("That employee no longer exists.");
    }

    await userRef.update({ autoPriority: Boolean(auto) });
  });
}

/** Sets one employee's monthly KPI targets. */
export async function setEmployeeTargets(
  token: string,
  uid: string,
  targets: Partial<KpiTargets>
): Promise<ActionResult<{ targets: KpiTargets }>> {
  return runAction("setEmployeeTargets", async () => {
    await requireAdmin(token);

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists || snap.data()?.role !== "employee") {
      throw new UserFacingError("That employee no longer exists.");
    }

    const next = normalizeTargets(targets);
    await userRef.update({ targets: next });
    return { targets: next };
  });
}

/** Updates an employee's display name (FR-1). */
export async function setEmployeeName(
  token: string,
  uid: string,
  name: string
): Promise<ActionResult> {
  return runAction("setEmployeeName", async () => {
    await requireAdmin(token);

    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      throw new UserFacingError("Enter a name.");
    }

    await adminDb.collection("users").doc(uid).update({ name: trimmed });
    await adminAuth.updateUser(uid, { displayName: trimmed }).catch(() => {});
  });
}

/** Updates comprehensive employee info (name, email, password, priority, targets). */
/**
 * The directory's optional fields, normalised the same way on create and edit.
 *
 * `autoAssign` is only ever written when explicitly passed: absent means "in
 * the lane", and writing `true` by default would churn every document the
 * first time anyone edits an unrelated field.
 */
function normalizeDirectoryFields(input: {
  phone?: string | null;
  notes?: string | null;
  joinedAt?: string | null;
  autoAssign?: boolean;
}): { phone: string | null; notes: string | null; joinedAt: Date | null; autoAssign?: boolean } {
  const phone = (input.phone ?? "").trim();
  const notes = (input.notes ?? "").trim();
  const raw = (input.joinedAt ?? "").trim();
  const parsed = raw ? new Date(raw) : null;

  return {
    phone: phone || null,
    notes: notes || null,
    // An unparseable date is dropped rather than stored as Invalid Date, which
    // would render as "—" forever with no way to tell it apart from empty.
    joinedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    autoAssign: typeof input.autoAssign === "boolean" ? input.autoAssign : undefined,
  };
}

export async function updateEmployee(
  token: string,
  uid: string,
  input: {
    name?: string;
    email?: string;
    password?: string;
    priority?: number;
    jobTitle?: string;
    targets?: Partial<KpiTargets>;
    phone?: string | null;
    notes?: string | null;
    joinedAt?: string | null;
    autoAssign?: boolean;
    /** Promote an employee to sub admin, or demote one back. */
    accessRole?: "employee" | "subadmin";
    /** `null` moves them under the admin directly. */
    subAdminUid?: string | null;
    /** Sales or HR (§13). Ignored unless the account is a manager. */
    managerKind?: ManagerKind;
    /** Base for percentage late deductions and the payroll figures (§5, §12). */
    monthlySalary?: number;
  }
): Promise<ActionResult> {
  return runAction("updateEmployee", async () => {
    await requireAdmin(token);

    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();
    const password = input.password;
    const priority = input.priority !== undefined ? normalizePriority(input.priority) : undefined;
    const jobTitle = input.jobTitle !== undefined ? normalizeJobTitle(input.jobTitle) : undefined;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserFacingError("Enter a valid email address.");
    }
    if (password && password.length < 8) {
      throw new UserFacingError("The password must be at least 8 characters.");
    }

    const authUpdates: Record<string, string> = {};
    if (name !== undefined) authUpdates.displayName = name;
    if (email !== undefined) authUpdates.email = email;
    if (password) authUpdates.password = password;

    if (Object.keys(authUpdates).length > 0) {
      try {
        await adminAuth.updateUser(uid, authUpdates);
      } catch (error: unknown) {
        const code = (error as { code?: string })?.code;
        if (code === "auth/email-already-exists") {
          throw new UserFacingError("An account with that email already exists.");
        }
        if (code === "auth/invalid-password") {
          throw new UserFacingError("That password is not strong enough.");
        }
        throw error;
      }
    }

    const dbUpdates: Record<string, unknown> = {};
    if (name !== undefined) dbUpdates.name = name;
    if (email !== undefined) dbUpdates.email = email;
    if (priority !== undefined) {
      dbUpdates.priority = priority;
      dbUpdates.autoPriority = false; // Same pinning rule as setEmployeePriority.
    }
    if (jobTitle !== undefined) dbUpdates.jobTitle = jobTitle;

    // Directory fields. Each is written only when the caller passed it, so the
    // edit form can send a subset without blanking everything it left out.
    const directory = normalizeDirectoryFields(input);
    if (input.phone !== undefined) dbUpdates.phone = directory.phone;
    if (input.notes !== undefined) dbUpdates.notes = directory.notes;
    if (input.joinedAt !== undefined) dbUpdates.joinedAt = directory.joinedAt;
    if (directory.autoAssign !== undefined) dbUpdates.autoAssign = directory.autoAssign;
    if (input.targets !== undefined) dbUpdates.targets = normalizeTargets(input.targets);
    if (input.monthlySalary !== undefined) {
      dbUpdates.monthlySalary = Math.max(0, Math.round(Number(input.monthlySalary) || 0));
    }
    // Only meaningful on a manager. It is written whenever the caller sends it
    // and the account is (or is becoming) a manager — the branch below handles
    // the promotion case, where `current.role` is still `employee`.
    if (input.managerKind !== undefined) {
      dbUpdates.managerKind = normalizeManagerKind(input.managerKind);
    }

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    const current = snap.data();
    if (!snap.exists || (current?.role !== "employee" && current?.role !== "subadmin")) {
      throw new UserFacingError("That team member no longer exists.");
    }

    // `undefined` means "this call is not changing their manager"; `null` means
    // "move them back under the admin". The two must stay distinguishable, or
    // an unrelated name edit would silently detach somebody from their team.
    let nextSubAdmin: string | null | undefined = undefined;

    // Changing the access role has to move the custom claim as well as the
    // document, or the person keeps their old screens until the claim happens
    // to be re-issued. Revoking the refresh token forces that refresh rather
    // than leaving them with the wrong menu until their token expires.
    const nextManagerKind =
      input.managerKind !== undefined
        ? normalizeManagerKind(input.managerKind)
        : normalizeManagerKind(current.managerKind);

    if (input.accessRole && input.accessRole !== current.role) {
      const nextRole: UserRole = input.accessRole;
      await adminAuth.setCustomUserClaims(uid, {
        role: nextRole,
        ...(nextRole === "subadmin" ? { managerKind: nextManagerKind } : {}),
      });
      await adminAuth.revokeRefreshTokens(uid).catch(() => {});
      dbUpdates.role = nextRole;

      // A sub admin is never managed by a sub admin. The hierarchy is two
      // levels deep on purpose: a chain of them would turn "whose team is
      // this" into a graph walk, and that walk would have to run inside
      // Security Rules, which cannot do it.
      if (nextRole === "subadmin") {
        nextSubAdmin = null;
        dbUpdates.subAdminUid = FieldValue.delete();
      }
    } else if (
      current.role === "subadmin" &&
      input.managerKind !== undefined &&
      nextManagerKind !== normalizeManagerKind(current.managerKind)
    ) {
      // Moving a manager between Sales and HR changes what they may reach, so
      // the claim has to move with the document and the old token has to go.
      // Leaving it would let an ex-HR manager keep the attendance settings
      // until their token happened to expire.
      await adminAuth.setCustomUserClaims(uid, { role: "subadmin", managerKind: nextManagerKind });
      await adminAuth.revokeRefreshTokens(uid).catch(() => {});
    }

    if (input.subAdminUid !== undefined && nextSubAdmin === undefined) {
      const effectiveRole = (dbUpdates.role as UserRole | undefined) ?? (current.role as UserRole);
      const resolved = await resolveSubAdminUid(input.subAdminUid, effectiveRole);
      if (resolved === uid) {
        throw new UserFacingError("Somebody cannot be their own manager.");
      }
      nextSubAdmin = resolved;
      dbUpdates.subAdminUid = resolved ?? FieldValue.delete();
    }

    if (Object.keys(dbUpdates).length > 0) {
      await userRef.update(dbUpdates);

      // Leads and deals carry a denormalised `subAdminUid` — it is what makes a
      // sub admin's list query provable to Security Rules. Moving somebody
      // between teams has to move their work with them, or their new manager
      // opens the dashboard to an empty team.
      if (nextSubAdmin !== undefined) {
        await reassignTeamOwnership(uid, nextSubAdmin);
      }
    }
  });
}

/**
 * Validates a proposed manager.
 *
 * Returns `null` for "managed by the admin directly", which is the absence of
 * the field everywhere else rather than a magic string.
 */
async function resolveSubAdminUid(
  raw: string | null | undefined,
  role: UserRole
): Promise<string | null> {
  const uid = (raw ?? "").trim();
  if (!uid || role === "subadmin") return null;

  const snap = await adminDb.collection("users").doc(uid).get();
  if (!snap.exists || snap.data()?.role !== "subadmin") {
    throw new UserFacingError("Choose a sub admin, or leave them under the admin.");
  }
  return uid;
}

/**
 * Re-stamps an employee's leads and deals when they change team.
 *
 * Paged batches rather than one write per document, and deliberately not a
 * transaction: this can span thousands of leads, far past the transaction
 * limit, and a half-finished run leaves some leads with the old manager rather
 * than corrupting anything. Re-running the same move finishes the job.
 */
async function reassignTeamOwnership(
  employeeUid: string,
  subAdminUid: string | null
): Promise<void> {
  const value = subAdminUid ?? FieldValue.delete();

  for (const collection of ["leads", "closedDeals"] as const) {
    const field = collection === "leads" ? "assignedUserId" : "userId";
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (;;) {
      let query = adminDb.collection(collection).where(field, "==", employeeUid).limit(400);
      if (cursor) query = query.startAfter(cursor);

      const page = await query.get();
      if (page.empty) break;

      const batch = adminDb.batch();
      page.docs.forEach((doc) => batch.update(doc.ref, { subAdminUid: value }));
      await batch.commit();

      if (page.size < 400) break;
      cursor = page.docs[page.size - 1];
    }
  }
}

/**
 * Moves one employee onto a sub admin's team, or back under the admin.
 *
 * Separate from `updateEmployee` because the directory offers it as a one-click
 * action on a row — and because it carries the re-stamping above, which an
 * inline field edit would be easy to forget.
 */
export async function setEmployeeSubAdmin(
  token: string,
  employeeUid: string,
  subAdminUid: string | null
): Promise<ActionResult<{ moved: string | null }>> {
  return runAction("setEmployeeSubAdmin", async () => {
    await requireAdmin(token);

    const userRef = adminDb.collection("users").doc(employeeUid);
    const snap = await userRef.get();
    if (!snap.exists || snap.data()?.role !== "employee") {
      throw new UserFacingError("That employee no longer exists.");
    }

    const resolved = await resolveSubAdminUid(subAdminUid, "employee");
    await userRef.update({ subAdminUid: resolved ?? FieldValue.delete() });
    await reassignTeamOwnership(employeeUid, resolved);

    return { moved: resolved };
  });
}

/**
 * Sets a sub admin's whole team in one call.
 *
 * The directory edits a sub admin by ticking employees, so the natural unit is
 * the list. Employees ticked off go back to the admin rather than to some other
 * sub admin — silently handing somebody to a third party is not a decision this
 * screen is entitled to make.
 */
export async function setSubAdminTeam(
  token: string,
  subAdminUid: string,
  employeeUids: string[]
): Promise<ActionResult<{ added: number; removed: number }>> {
  return runAction("setSubAdminTeam", async () => {
    await requireAdmin(token);

    const subAdmin = await adminDb.collection("users").doc(subAdminUid).get();
    if (!subAdmin.exists || subAdmin.data()?.role !== "subadmin") {
      throw new UserFacingError("That sub admin no longer exists.");
    }

    const wanted = new Set((employeeUids ?? []).filter(Boolean));
    const current = await adminDb.collection("users").where("subAdminUid", "==", subAdminUid).get();

    const held = new Set(current.docs.map((doc) => doc.id));
    const toAdd = [...wanted].filter((uid) => !held.has(uid));
    const toRemove = [...held].filter((uid) => !wanted.has(uid));

    for (const uid of toAdd) {
      const snap = await adminDb.collection("users").doc(uid).get();
      if (!snap.exists || snap.data()?.role !== "employee") continue;
      await adminDb.collection("users").doc(uid).update({ subAdminUid });
      await reassignTeamOwnership(uid, subAdminUid);
    }

    for (const uid of toRemove) {
      await adminDb.collection("users").doc(uid).update({ subAdminUid: FieldValue.delete() });
      await reassignTeamOwnership(uid, null);
    }

    return { added: toAdd.length, removed: toRemove.length };
  });
}

/**
 * The roster a manager is entitled to see, resolved server-side.
 *
 * A sub admin's browser cannot list `users` — Security Rules refuse a query
 * whose scope they cannot prove from the query's own constraints — so this is
 * how their directory is populated. An admin gets the same shape so the screen
 * has one code path rather than two.
 */
export async function listManagedTeam(
  token: string
): Promise<ActionResult<{ members: TeamMember[] }>> {
  return runAction("listManagedTeam", async () => {
    const auth = await requireManager(token);

    const query =
      auth.role === "admin"
        ? adminDb.collection("users").where("role", "in", ["employee", "subadmin"])
        : adminDb.collection("users").where("subAdminUid", "==", auth.uid);

    const snap = await query.get();
    return { members: snap.docs.map((doc) => toTeamMember(doc.id, doc.data())) };
  });
}

export interface TeamMember {
  uid: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string;
  status: "ACTIVE" | "DISABLED";
  priority: number;
  subAdminUid: string | null;
}

function toTeamMember(uid: string, data: Record<string, unknown>): TeamMember {
  return {
    uid,
    name: (data.name as string) || (data.email as string) || "Unnamed",
    email: (data.email as string) || "",
    role: (data.role as string) || "employee",
    jobTitle: normalizeJobTitle(data.jobTitle),
    status: data.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    priority: typeof data.priority === "number" ? data.priority : 99,
    subAdminUid: (data.subAdminUid as string) ?? null,
  };
}


/**
 * Disables an employee (FR-2, FR-3, BR-22).
 *
 * Never deletes. The Auth account is disabled so they cannot sign in, and
 * because `verifyAuth` checks for revocation their existing session stops
 * working immediately rather than lasting until the token expires. All of their
 * historical leads, follow-ups and deals stay exactly where they are.
 */
export async function disableEmployee(token: string, uid: string): Promise<ActionResult<{ openLeads: number }>> {
  return runAction("disableEmployee", async () => {
    const admin = await requireAdmin(token);

    if (uid === admin.uid) {
      throw new UserFacingError("You cannot disable your own account.");
    }

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      throw new UserFacingError("That employee no longer exists.");
    }

    await adminAuth.updateUser(uid, { disabled: true });
    await adminAuth.revokeRefreshTokens(uid);
    await userRef.update({
      status: "DISABLED",
      disabledAt: FieldValue.serverTimestamp(),
      disabledByUid: admin.uid,
    });

    // Tell the admin how many leads now need rehoming (FR-3).
    const openLeads = await adminDb
      .collection("leads")
      .where("assignedUserId", "==", uid)
      .where("status", "in", ["ASSIGNED", "ACCEPTED", "CONTACTED", "FOLLOW_UP", "INTERESTED", "NEGOTIATION", "CLOSED_LOST", "CLOSED_WON", "DEAD"])
      .count()
      .get();

    return { openLeads: openLeads.data().count };
  });
}

/** Brings a disabled employee back (FR-2 — the missing half of disable). */
export async function enableEmployee(token: string, uid: string): Promise<ActionResult> {
  return runAction("enableEmployee", async () => {
    const admin = await requireAdmin(token);

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      throw new UserFacingError("That employee no longer exists.");
    }

    await adminAuth.updateUser(uid, { disabled: false });
    await userRef.update({
      status: "ACTIVE",
      disabledAt: FieldValue.delete(),
      disabledByUid: FieldValue.delete(),
      reEnabledAt: FieldValue.serverTimestamp(),
      reEnabledByUid: admin.uid,
    });
  });
}

/**
 * Re-ranks the lane from this month's KPI performance.
 *
 * The work itself lives in `lib/server/recalcPriorities` so the nightly cron
 * runs exactly the same code path; this is only the admin-authorised entry.
 */
export async function recalculateEmployeePriorities(
  token: string
): Promise<ActionResult<{ changes: PriorityChange[]; evaluated: number }>> {
  return runAction("recalculateEmployeePriorities", async () => {
    const admin = await requireAdmin(token);
    const { changes, evaluated } = await recalculatePriorities(admin.uid);
    return { changes, evaluated };
  });
}

function normalizePriority(value: unknown): number {
  const priority = Math.floor(Number(value));
  if (!Number.isFinite(priority) || priority < MIN_PRIORITY || priority > MAX_PRIORITY) {
    throw new UserFacingError(
      `Priority must be a number between ${MIN_PRIORITY} and ${MAX_PRIORITY}.`
    );
  }
  return priority;
}
