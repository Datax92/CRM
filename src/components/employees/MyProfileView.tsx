"use client";

/**
 * My Profile — the profile the admin opens from Team, shown to the person it is
 * about (owner, 2026-09-24).
 *
 * **The same component, not a copy of it.** The desktop renders
 * `EmployeeDetailModal` and the phone `ProfileOverlay`, exactly as the Team
 * screen does, so an employee reads the same numbers the admin reads about them.
 *
 * - **Employee:** their own leads, deals and activity.
 * - **Manager:** themselves and their team (a manager's profile), and each team
 *   member opens their own profile, as on the Team screen.
 *
 * Every read is scoped the way its Security Rule checks: the person's own
 * `users` document, their own leads (`assignedUserId == me`, or the team's
 * `subAdminUid == me`), their own or their team's deals. Nothing here is
 * readable that the person could not already read on another screen, and the
 * activity figures come through `buildActivityBreakdown`, which re-checks reach
 * on the server.
 *
 * Editing is absent — changing a profile is `requireAdmin`.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLeads } from "@/hooks/useLeads";
import { useFinancials, useMyDeals } from "@/hooks/useFinancials";
import { useEmployees, useOwnEmployeeRecord } from "@/hooks/useEmployees";
import { buildEmployeeMetrics, type EmployeeMetrics } from "@/lib/metrics";
import { resolveRange } from "@/lib/dates";
import { FullPageSpinner } from "@/components/admin/AdminShared";
import { EmployeeDetailModal } from "./EmployeeDetailModal";
import { ProfileOverlay } from "@/components/mobile/MobileEmployees";

/** Lifetime — the profile's own period control narrows it. */
const ALL_TIME = resolveRange("ALL");

export function MyProfileView({ scope }: { scope: "employee" | "subadmin" }) {
  const { user, role, loading: authLoading } = useAuth();
  useProtectedRoute([scope]);
  const router = useRouter();
  const isMobile = useIsMobile();

  const ready = role === scope && Boolean(user?.uid);
  const uid = ready ? user?.uid : undefined;
  const isManager = scope === "subadmin";

  const { record, loading: recordLoading } = useOwnEmployeeRecord(uid);
  const { leads, loading: leadsLoading } = useLeads(ready ? scope : null, user?.uid);
  // An employee reads `closedDeals where userId == me`; a manager their team's,
  // which includes deals on leads assigned to themselves.
  const { deals: myDeals } = useMyDeals(ready && !isManager ? uid : undefined, ALL_TIME);
  const { allDeals: teamDeals } = useFinancials(ALL_TIME, ready && isManager, { role: scope, uid });
  const deals = isManager ? teamDeals : myDeals;
  const { employees: teamRoster } = useEmployees(ready && isManager, { role: scope, uid });

  const me = useMemo<EmployeeMetrics | null>(
    () => (record ? (buildEmployeeMetrics([record], leads, deals)[0] ?? null) : null),
    [record, leads, deals]
  );
  const team = useMemo(
    () => (isManager ? buildEmployeeMetrics(teamRoster, leads, deals) : undefined),
    [isManager, teamRoster, leads, deals]
  );

  // A manager may open one of their people from the Team tab.
  const [memberUid, setMemberUid] = useState<string | null>(null);
  const member = memberUid ? (team?.find((person) => person.uid === memberUid) ?? null) : null;

  if (authLoading || recordLoading || leadsLoading) return <FullPageSpinner />;

  if (!me) {
    return (
      <div style={{ padding: 24, fontSize: 14, color: "#5b6d6b" }}>
        Your profile could not be loaded. Try again in a moment.
      </div>
    );
  }

  const leave = () => router.push("/home");

  if (member) {
    return isMobile ? (
      <ProfileOverlay key={member.uid} employee={member} leads={leads} deals={deals} onClose={() => setMemberUid(null)} />
    ) : (
      <EmployeeDetailModal key={member.uid} employee={member} leads={leads} deals={deals} onClose={() => setMemberUid(null)} />
    );
  }

  return isMobile ? (
    <ProfileOverlay
      employee={me}
      leads={leads}
      deals={deals}
      team={team}
      onOpenMember={(person) => setMemberUid(person.uid)}
      onClose={leave}
    />
  ) : (
    <EmployeeDetailModal
      employee={me}
      leads={leads}
      deals={deals}
      team={team}
      onOpenMember={(person) => setMemberUid(person.uid)}
      onClose={leave}
    />
  );
}
