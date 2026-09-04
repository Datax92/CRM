"use client";

/**
 * A sub admin's team.
 *
 * **The same screen the admin gets**, scoped to their own people — the hero,
 * the stat cards, the roster with its search and Active/Inactive filter, the
 * pagination, and the full employee dossier with its leads, deals, activity and
 * analytics tabs. It renders `DirectoryView`, the admin directory's own
 * component, rather than a second implementation of it: this page used to be a
 * different screen entirely, and two versions of "the team" drift the first
 * time either is touched.
 *
 * The scoping is not done here. `useEmployees`, `useLeads` and `useFinancials`
 * all carry a `subAdminUid == me` constraint, and the Security Rules behind
 * them refuse anything wider — Firestore checks a list query *before* running
 * it, so this page could not show another team's data if it tried.
 *
 * **What differs is authority, not appearance.** Create, edit, pause, set a
 * lane priority and recalculate the lane are all `requireAdmin` on the server,
 * so those controls are absent for this role rather than present and failing.
 * Everything that reads is identical.
 */

import { DirectoryView } from "@/components/employees/DirectoryView";

export default function SubAdminTeamPage() {
  return <DirectoryView scope="subadmin" />;
}
