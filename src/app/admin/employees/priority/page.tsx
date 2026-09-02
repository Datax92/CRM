"use client";

import { useState, useMemo } from "react";
import { MAX_PRIORITY } from "@/lib/constants/distribution";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useEmployees } from "@/hooks/useEmployees";
import { useLeads } from "@/hooks/useLeads";
import { useFinancials } from "@/hooks/useFinancials";
import { buildEmployeeMetrics } from "@/lib/metrics";
import { Search } from "lucide-react";
import { Banner, FullPageSpinner, ResponsiveTableWrapper, TableRow, TableCell } from "@/components/admin/AdminShared";
import { EmployeeStatusBadge } from "@/components/ui/AdminTable";
import { setEmployeePriority, disableEmployee, enableEmployee } from "@/lib/clientActions";

export default function PrioritySettingsPage() {
  const { role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";
  const { employees, loading: empLoading, error: empError } = useEmployees(isAdmin);
  const { leads, loading: leadsLoading } = useLeads(isAdmin ? "admin" : null);
  const { allDeals } = useFinancials({ key: "ALL", from: null, to: null, label: "ALL" }, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const [localPriorities, setLocalPriorities] = useState<Record<string, number>>({});
  const [localStatuses, setLocalStatuses] = useState<Record<string, "ACTIVE" | "DISABLED">>({});

  const metrics = useMemo(() => buildEmployeeMetrics(employees, leads, allDeals), [employees, leads, allDeals]);

  const visibleMetrics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const withOptimistic = metrics.map((emp) => ({
      ...emp,
      priority: localPriorities[emp.uid] ?? emp.priority,
      status: localStatuses[emp.uid] ?? emp.status,
    }));
    return withOptimistic
      .filter((emp) => {
        if (q && !emp.name.toLowerCase().includes(q) && !emp.email.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.name.localeCompare(b.name);
      });
  }, [metrics, searchQuery, localPriorities, localStatuses]);

  if (authLoading || empLoading || leadsLoading) return <FullPageSpinner />;

  const changePriority = async (uid: string, newPriority: number) => {
    setLocalPriorities((prev) => ({ ...prev, [uid]: newPriority }));
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = await setEmployeePriority(token, uid, newPriority);
      if (!res.ok) {
        setLocalPriorities((prev) => { const next = { ...prev }; delete next[uid]; return next; });
        setBanner({ tone: "error", text: res.error || "Failed to update priority." });
      } else {
        setBanner(null);
      }
    } catch {
      setLocalPriorities((prev) => { const next = { ...prev }; delete next[uid]; return next; });
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (uid: string, currentStatus: "ACTIVE" | "DISABLED") => {
    const nextStatus = currentStatus === "ACTIVE" ? "DISABLED" : "ACTIVE";
    setLocalStatuses((prev) => ({ ...prev, [uid]: nextStatus }));
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = nextStatus === "DISABLED" ? await disableEmployee(token, uid) : await enableEmployee(token, uid);
      if (!res.ok) {
        setLocalStatuses((prev) => { const next = { ...prev }; delete next[uid]; return next; });
        setBanner({ tone: "error", text: res.error || "Failed to update status." });
      } else {
        setBanner(null);
      }
    } catch {
      setLocalStatuses((prev) => { const next = { ...prev }; delete next[uid]; return next; });
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Priority Settings</h1>
        <p className="text-sm text-slate-500">Manage lead distribution priority and active/disabled status.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="search"
            placeholder="Search employees..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary outline-none"
          />
        </div>
      </div>

      {(banner || empError) && (
        <div className="space-y-2">
          {empError && <Banner tone="error" text={empError} />}
          {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}
        </div>
      )}

      <ResponsiveTableWrapper minWidth={600}>
        <table className="w-full text-sm text-slate-900">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Priority Ranking</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleMetrics.map((emp) => (
              <TableRow key={emp.uid}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{emp.name}</div>
                  <div className="text-xs text-slate-500">{emp.email}</div>
                </TableCell>
                <TableCell>
                  <EmployeeStatusBadge status={emp.status} />
                </TableCell>
                <TableCell numeric>
                  <select
                    className="cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 pr-8 text-xs font-semibold text-slate-900 outline-none focus:border-primary disabled:opacity-50"
                    value={emp.priority}
                    onChange={(e) => changePriority(emp.uid, parseInt(e.target.value, 10))}
                    disabled={busy || emp.status === "DISABLED"}
                  >
                    {Array.from({ length: MAX_PRIORITY }, (_, i) => i + 1).map((num) => (
                      <option key={num} value={num}>Priority {num}</option>
                    ))}
                  </select>
                </TableCell>
                <TableCell numeric>
                  <button
                    onClick={() => toggleStatus(emp.uid, emp.status)}
                    disabled={busy}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline disabled:opacity-50"
                  >
                    {emp.status === "ACTIVE" ? "Pause distribution" : "Resume distribution"}
                  </button>
                </TableCell>
              </TableRow>
            ))}
            {visibleMetrics.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No employees match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
    </div>
  );
}

