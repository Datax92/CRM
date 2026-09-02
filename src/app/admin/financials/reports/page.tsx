"use client";

import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useLeads } from "@/hooks/useLeads";
import { useEmployees } from "@/hooks/useEmployees";
import { useFinancials } from "@/hooks/useFinancials";
import { resolveRange, RANGE_LABELS, type RangeKey } from "@/lib/dates";
import { buildEmployeeMetrics, buildCampaignMetrics, rankEmployees, RANKING_OPTIONS, type RankingKey } from "@/lib/metrics";
import { SelectPill, SelectOption } from "@/app/admin/SelectPill";
import { TablePanel, TabSectionHeading, EmptyTableState } from "@/components/ui/AdminTable";
import { formatMoney } from "@/lib/money";
import { ResponsiveTableWrapper, TableRow, TableCell, FullPageSpinner, Banner } from "@/components/admin/AdminShared";
import { Search, Filter } from "lucide-react";

export default function ReportsPage() {
  const { user, role, loading: authLoading } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const { leads, loading: leadsLoading, error: leadsError } = useLeads(isAdmin ? "admin" : null);
  const { employees, error: employeesError } = useEmployees(isAdmin);

  const [rangeKey, setRangeKey] = useState<RangeKey>("MONTH");
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);
  const { allDeals } = useFinancials(range, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [campaignFilter, setCampaignFilter] = useState("ALL");
  const [rankBy, setRankBy] = useState<RankingKey>("profit");
  const [activeView, setActiveView] = useState<"employee" | "campaign">("employee");

  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    leads.forEach((lead) => {
      if (lead.campaignId) map.set(lead.campaignId, lead.campaignName ?? lead.campaignId);
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [leads]);

  const employeeMetrics = useMemo(
    () => buildEmployeeMetrics(employees, leads, allDeals, range),
    [employees, leads, allDeals, range]
  );
  
  const campaignMetrics = useMemo(
    () => buildCampaignMetrics(leads, allDeals, range),
    [leads, allDeals, range]
  );

  const ranked = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = employeeMetrics.filter((emp) => {
      if (employeeFilter !== "ALL" && emp.uid !== employeeFilter) return false;
      if (q && !emp.name.toLowerCase().includes(q) && !emp.email.toLowerCase().includes(q)) return false;
      return true;
    });
    return rankEmployees(filtered, rankBy);
  }, [employeeMetrics, rankBy, searchQuery, employeeFilter]);

  const visibleCampaigns = useMemo(() =>
    campaignFilter === "ALL" ? campaignMetrics : campaignMetrics.filter((c) => c.campaignId === campaignFilter),
    [campaignMetrics, campaignFilter]
  );
  
  const best = ranked[0];

  if (authLoading || (isAdmin && leadsLoading)) return <FullPageSpinner />;
  if (!user || !isAdmin) return null;

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">Analyze performance and campaign metrics over time.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm justify-between items-center">
        <div className="relative flex-1 w-full lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="search"
            placeholder="Search employee name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SelectPill label="Period" value={rangeKey} onChange={(v) => setRangeKey(v as RangeKey)} icon={<Filter size={13} className="shrink-0 text-slate-500" aria-hidden="true" />}>
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
              <SelectOption key={key} value={key}>{RANGE_LABELS[key]}</SelectOption>
            ))}
          </SelectPill>
          <SelectPill label="Employee" value={employeeFilter} onChange={setEmployeeFilter}>
            <SelectOption value="ALL">All employees</SelectOption>
            {employees.map((emp) => (
              <SelectOption key={emp.uid} value={emp.uid}>{emp.name}</SelectOption>
            ))}
          </SelectPill>
          {campaigns.length > 0 && (
            <SelectPill label="Campaign" value={campaignFilter} onChange={setCampaignFilter}>
              <SelectOption value="ALL">All campaigns</SelectOption>
              {campaigns.map((c) => (
                <SelectOption key={c.id} value={c.id}>{c.name}</SelectOption>
              ))}
            </SelectPill>
          )}
        </div>
      </div>

      <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveView("employee")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeView === "employee" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Employee Performance
        </button>
        <button
          onClick={() => setActiveView("campaign")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeView === "campaign" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Campaign Performance
        </button>
      </div>

      {(leadsError || employeesError) && (
        <div className="space-y-2">
          {leadsError && <Banner tone="error" text={leadsError} />}
          {employeesError && <Banner tone="error" text={employeesError} />}
        </div>
      )}

      {/* Reports Content */}
      <div className="space-y-8">
      {activeView === "employee" && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabSectionHeading title="Performance by Employee" subtitle={range.label} />
            <SelectPill label="Rank by" value={rankBy} onChange={(v) => setRankBy(v as RankingKey)}>
              {RANKING_OPTIONS.map((option) => (
                <SelectOption key={option.key} value={option.key}>{option.label}</SelectOption>
              ))}
            </SelectPill>
          </div>
  
          <div className="w-full overflow-x-auto">

            <TablePanel
              minWidth={860}
              footer={
                best && best.assigned > 0
                  ? <>Leading on {RANKING_OPTIONS.find((o) => o.key === rankBy)?.label.toLowerCase()}: <span className="font-semibold text-slate-900">{best.name}</span></>
                  : undefined
              }
            >
              <table className="w-full text-sm text-slate-900">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                  <tr>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[60px]">#</th>
                    <th className="text-left px-4 py-3 min-w-[180px]">Employee</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[100px]">Handled</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[100px]">Accepted</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[100px]">Missed</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[100px]">Follow-ups</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[100px]">Calls</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[100px]">Closed</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[120px]">Revenue</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[120px]">Profit</th>
                    <th className="text-right px-4 py-3 tabular-nums min-w-[80px]">Conv.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {ranked.length === 0 && (
                    <TableRow>
                      <td colSpan={11} className="px-4 py-8 text-center text-slate-500" data-label="">No employee data for this period.</td>
                    </TableRow>
                  )}
                  {ranked.map((emp, index) => (
                    <TableRow key={emp.uid} className={emp.status === "DISABLED" ? "opacity-60" : ""}>
                      <TableCell label="#" numeric className="font-semibold text-slate-900 px-4">{index + 1}</TableCell>
                      <TableCell label="Employee" className="px-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-500">#{index + 1}</span>
                          <div>
                            <p className="font-semibold text-sm text-slate-900">{emp.name}</p>
                            <p className="text-[11px] text-slate-500">Priority {emp.priority}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell label="Handled" numeric className="px-4">{emp.assigned}</TableCell>
                      <TableCell label="Accepted" numeric className="px-4">{emp.accepted}</TableCell>
                      <TableCell label="Missed" numeric tone="loss" className="px-4">{emp.missed}</TableCell>
                      <TableCell label="Follow-ups" numeric className="px-4">{emp.followUps}</TableCell>
                      <TableCell label="Calls" numeric className="px-4">{emp.calls}</TableCell>
                      <TableCell label="Closed" numeric className="px-4">{emp.closedWon}</TableCell>
                      <TableCell label="Revenue" numeric className="px-4">{formatMoney(emp.revenue)}</TableCell>
                      <TableCell label="Profit" numeric tone={emp.profit >= 0 ? "positive" : "negative"} className="px-4">
                        {formatMoney(emp.profit)}
                      </TableCell>
                      <TableCell label="Conv." numeric className="px-4">{emp.conversionRate.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </TablePanel>

        </div>
        </div>
      )}

      {activeView === "campaign" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabSectionHeading
              title="Campaign performance"
              subtitle="Which ads are actually paying for themselves."
            />
          </div>
          {visibleCampaigns.length === 0 ? (
            <EmptyTableState message="No campaign data for the current filters." />
          ) : (

              <TablePanel minWidth={720}>
                <table className="w-full text-sm text-slate-900">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                    <tr>
                      <th className="text-left px-4 py-3">Campaign</th>
                      <th className="text-right px-4 py-3 tabular-nums">Leads</th>
                      <th className="text-right px-4 py-3 tabular-nums">Closed</th>
                      <th className="text-right px-4 py-3 tabular-nums">Conv.</th>
                      <th className="text-right px-4 py-3 tabular-nums">Revenue</th>
                      <th className="text-right px-4 py-3 tabular-nums">Profit</th>
                      <th className="text-right px-4 py-3 tabular-nums">Value / lead</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {visibleCampaigns.map((campaign) => (
                      <TableRow key={campaign.campaignId}>
                        <TableCell label="Campaign" className="font-semibold text-slate-900">{campaign.name}</TableCell>
                        <TableCell label="Leads" numeric>{campaign.leads}</TableCell>
                        <TableCell label="Closed" numeric>{campaign.closedWon}</TableCell>
                        <TableCell label="Conv." numeric>{campaign.conversionRate.toFixed(1)}%</TableCell>
                        <TableCell label="Revenue" numeric>{formatMoney(campaign.revenue)}</TableCell>
                        <TableCell label="Profit" numeric tone={campaign.profit >= 0 ? "positive" : "negative"}>
                          {formatMoney(campaign.profit)}
                        </TableCell>
                        <TableCell label="Value / lead" numeric className="text-slate-500">
                          {formatMoney(campaign.valuePerLead)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </table>
              </TablePanel>

          )}
        </div>
      )}
      </div>
    </div>
  );
}

