"use client";

/**
 * A sub admin's team (§10).
 *
 * Everything the employees under this manager are doing — leads, follow-ups,
 * pipeline status and stage, deals and performance — and nothing belonging to
 * anyone else. The scoping is not done here: `useEmployees` and `useLeads` both
 * carry a `subAdminUid == me` constraint, and the Security Rules behind them
 * refuse anything wider. This page could not show another team's data if it
 * tried.
 *
 * **What it deliberately omits** is a management control of any kind. A sub
 * admin does not create employees, set priorities, change targets or move
 * people between teams — those are the admin's decisions, the Server Actions
 * refuse them for this role, and offering the buttons would only produce
 * errors. The dossier opens read-only.
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useEmployees } from "@/hooks/useEmployees";
import { useLeads } from "@/hooks/useLeads";
import { useFinancials } from "@/hooks/useFinancials";
import { buildEmployeeMetrics } from "@/lib/metrics";
import { EmployeeDetailModal } from "@/components/employees/EmployeeDetailModal";
import { FullPageSpinner } from "@/components/admin/AdminShared";
import { formatMoney } from "@/lib/money";
import { Users } from "lucide-react";

const ALL_TIME = { key: "ALL" as const, from: null, to: null, label: "ALL" };

export default function SubAdminTeamPage() {
  const { user, role, loading: authLoading } = useAuth();
  useProtectedRoute(["subadmin"]);
  const isSubAdmin = role === "subadmin";

  const { employees, loading: rosterLoading } = useEmployees(isSubAdmin, { role, uid: user?.uid });
  const { leads, loading: leadsLoading } = useLeads(isSubAdmin ? "subadmin" : null, user?.uid);
  const { allDeals } = useFinancials(ALL_TIME, isSubAdmin);

  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const metrics = useMemo(
    () => buildEmployeeMetrics(employees, leads, allDeals),
    [employees, leads, allDeals]
  );

  const selected = metrics.find((person) => person.uid === selectedUid) ?? null;

  const totals = useMemo(
    () => ({
      leads: metrics.reduce((sum, person) => sum + person.assigned, 0),
      active: metrics.reduce((sum, person) => sum + person.active, 0),
      won: metrics.reduce((sum, person) => sum + person.closedWon, 0),
      revenue: metrics.reduce((sum, person) => sum + (person.revenue ?? 0), 0),
    }),
    [metrics]
  );

  if (authLoading || (isSubAdmin && (rosterLoading || leadsLoading))) return <FullPageSpinner />;
  if (!isSubAdmin) return null;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-7 sm:px-7">
      <header className="mb-6 flex items-center gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: "#e2f0ee", color: "#2f7d78" }}
          aria-hidden
        >
          <Users size={20} />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold text-[#1f3b39]">My Team</h1>
          <p className="text-[13px] text-[#7e918f]">
            {metrics.length} employee{metrics.length === 1 ? "" : "s"} · {totals.active} active lead
            {totals.active === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Leads handled" value={totals.leads.toLocaleString()} />
        <Tile label="Active now" value={totals.active.toLocaleString()} />
        <Tile label="Deals won" value={totals.won.toLocaleString()} />
        <Tile label="Revenue" value={formatMoney(totals.revenue)} accent />
      </div>

      {metrics.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#cfe2e0] bg-white/70 p-8 text-center text-[13px] text-[#7e918f]">
          No employees have been assigned to you yet. The admin assigns a team from the Employee
          Directory.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#e0eeec] bg-white">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-[#f0f6f5] text-left text-[11px] tracking-[0.6px] text-[#7e918f] uppercase">
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="w-[92px] px-4 py-3 text-right font-semibold">Leads</th>
                <th className="w-[92px] px-4 py-3 text-right font-semibold">Active</th>
                <th className="w-[92px] px-4 py-3 text-right font-semibold">Won</th>
                <th className="w-[150px] px-4 py-3 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((person) => (
                <tr
                  key={person.uid}
                  onClick={() => setSelectedUid(person.uid)}
                  className="cursor-pointer border-b border-[#f6faf9] transition-colors last:border-0 hover:bg-[#f6faf9]"
                >
                  <td className="px-4 py-3">
                    <p className="truncate text-[13.5px] text-[#1f3b39]">{person.name}</p>
                    <p className="truncate text-[11.5px] text-[#9aacaa]">{person.jobTitle}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[#5b6d6b]">
                    {person.assigned}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[#5b6d6b]">
                    {person.active}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[#5b6d6b]">
                    {person.closedWon}
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold tabular-nums text-[#2f7d78]">
                    {formatMoney(person.revenue ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <EmployeeDetailModal
          employee={selected}
          leads={leads}
          deals={allDeals}
          onClose={() => setSelectedUid(null)}
          // Editing an employee is the admin's decision, and the Server Action
          // refuses it for this role — so the dossier's Edit button closes the
          // dossier and does nothing else rather than opening a form that
          // cannot save.
          onEdit={() => setSelectedUid(null)}
        />
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[#e0eeec] bg-white px-5 py-4">
      <p className="text-[11px] font-semibold tracking-[0.6px] text-[#7e918f] uppercase">{label}</p>
      <p
        className="mt-1.5 text-[22px] font-bold tabular-nums"
        style={{ color: accent ? "#2f7d78" : "#1f3b39" }}
      >
        {value}
      </p>
    </div>
  );
}
